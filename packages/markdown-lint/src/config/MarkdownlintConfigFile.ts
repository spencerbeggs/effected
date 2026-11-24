// Reads markdownlint configuration files from disk and resolves the one that
// applies to a markdown file, the way markdownlint-cli2 does: in each
// directory the first of `.markdownlint.jsonc`, `.json`, `.yaml`, `.yml` is
// that directory's config, and the nearest directory holding one decides,
// with its own `extends` chain; ancestors are not merged in (cli2 replaces,
// it does not layer). Content is parsed as cli2 does, JSONC first (trailing
// commas allowed) and YAML second, whatever the file's extension.
//
// Named divergences from markdownlint-cli2, pinned in
// __test__/config-file.test.ts and recorded in okf/modules/markdown-lint.md:
// - JavaScript configs (`.markdownlint.cjs`/`.mjs`) and cli2's own options
//   files (`.markdownlint-cli2.*`) are never loaded. Met on the walk they go
//   in `skipped` and the walk continues, where cli2 would load a JS config and
//   stop; named directly or by `extends` they fail `unsupported`.
// - cli2's TOML parser (tried between JSONC and YAML) is not modelled.
// - A parsed value that is not a plain object fails `parse`, where
//   markdownlint reads it as `{}`.
// - A truthy non-string `extends` fails `parse`, where markdownlint throws a
//   TypeError out of its callback.
//
// The only module of the package that touches the file system; nothing
// reachable from the package root imports it.

import { Jsonc } from "@effected/jsonc";
import type * as Lint from "@effected/markdown-lint";
import { Yaml } from "@effected/yaml";
import { Effect, FileSystem, Path, Predicate, Result, Schema } from "effect";
import { LintConfig } from "../LintConfig.js";

/** The most `extends` links one chain may follow. */
const MAX_EXTENDS_DEPTH = 16;

/** The largest config file read, in bytes; checked before parsing. */
const MAX_FILE_BYTES = 1024 * 1024;

/** The config file names one directory may hold, in cli2's precedence order. */
const SUPPORTED_NAMES = [".markdownlint.jsonc", ".markdownlint.json", ".markdownlint.yaml", ".markdownlint.yml"];

/** The config file names cli2 reads that this package does not, in cli2's order. */
const UNSUPPORTED_NAMES = [
	".markdownlint.cjs",
	".markdownlint.mjs",
	".markdownlint-cli2.jsonc",
	".markdownlint-cli2.yaml",
	".markdownlint-cli2.cjs",
	".markdownlint-cli2.mjs",
];

const isUnsupported = (name: string): boolean =>
	name === ".markdownlint.cjs" || name === ".markdownlint.mjs" || name.startsWith(".markdownlint-cli2.");

const isPlainObject = (value: unknown): value is Lint.LintConfigRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A markdownlint configuration file could not be read or resolved.
 *
 * @remarks
 * `reason` says why:
 * - `unreadable`: the file could not be read, or `resolve` was given a file outside its root
 * - `parse`: the content is neither JSONC nor YAML, is not an object, or has a non-string `extends`
 * - `extends-missing`: an `extends` target does not exist
 * - `extends-cycle`: an `extends` chain re-enters a file
 * - `extends-depth`: an `extends` chain is longer than 16 links
 * - `too-large`: the file is larger than 1 MiB
 * - `unsupported`: a JavaScript config or a markdownlint-cli2 options file
 *
 * `path` is the offending file: the missing, re-entered or refused `extends`
 * target, or the file that failed to read or parse.
 *
 * @public
 */
export class MarkdownlintConfigError extends Schema.TaggedError<MarkdownlintConfigError>()("MarkdownlintConfigError", {
	/** Why the config could not be read or resolved. */
	reason: Schema.Literals([
		"unreadable",
		"parse",
		"extends-missing",
		"extends-cycle",
		"extends-depth",
		"too-large",
		"unsupported",
	]),
	/** The offending file. */
	path: Schema.String,
	/** What went wrong, in words. */
	detail: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const head = `markdownlint config ${this.reason} at "${this.path}"`;
		return this.detail === undefined ? head : `${head}: ${this.detail}`;
	}
}

/**
 * The configuration that applies to one markdown file.
 *
 * @public
 */
export interface ResolvedLintConfig {
	/** The configuration, with its `extends` chain applied. */
	readonly config: Lint.LintConfigRecord;
	/** Config files that contributed: the deciding file, then its `extends` chain in the order read. */
	readonly files: ReadonlyArray<string>;
	/** Unsupported files met on the walk and ignored. */
	readonly skipped: ReadonlyArray<string>;
}

interface ReadChain {
	readonly config: Lint.LintConfigRecord;
	readonly files: ReadonlyArray<string>;
}

const fail = (
	reason: MarkdownlintConfigError["reason"],
	path: string,
	extra: { readonly detail?: string; readonly cause?: unknown } = {},
) => Effect.fail(MarkdownlintConfigError.make({ reason, path, ...extra }));

/** JSONC first, then YAML: cli2's parser order without its TOML step. */
const parseContent = (text: string): Result.Result<unknown, ReadonlyArray<unknown>> => {
	const jsonc = Jsonc.parseResult(text, { allowTrailingComma: true });
	if (Result.isSuccess(jsonc)) return Result.succeed(jsonc.success);
	const yaml = Yaml.parseResult(text);
	if (Result.isSuccess(yaml)) return Result.succeed(yaml.success);
	return Result.fail([jsonc.failure, yaml.failure]);
};

/** Read and parse one file at an absolute path, without following `extends`. */
const readOne = Effect.fnUntraced(function* (file: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (isUnsupported(path.basename(file))) {
		return yield* fail("unsupported", file, { detail: "JavaScript and markdownlint-cli2 config files are not read" });
	}
	const info = yield* fs.stat(file).pipe(Effect.catch((cause) => fail("unreadable", file, { cause })));
	if (info.size > BigInt(MAX_FILE_BYTES)) {
		return yield* fail("too-large", file, { detail: `${info.size} bytes exceeds ${MAX_FILE_BYTES}` });
	}
	const bytes = yield* fs.readFile(file).pipe(Effect.catch((cause) => fail("unreadable", file, { cause })));
	// The file may have grown between the stat and the read.
	if (bytes.length > MAX_FILE_BYTES) {
		return yield* fail("too-large", file, { detail: `${bytes.length} bytes exceeds ${MAX_FILE_BYTES}` });
	}
	const parsed = parseContent(new TextDecoder().decode(bytes));
	if (Result.isFailure(parsed)) {
		return yield* fail("parse", file, { detail: "neither JSONC nor YAML", cause: parsed.failure });
	}
	if (!isPlainObject(parsed.success)) {
		return yield* fail("parse", file, { detail: "the configuration is not an object" });
	}
	return parsed.success;
});

/** Read `file` and follow its `extends` chain; `chain` holds the files that extended it, outermost first. */
const readChain = (
	file: string,
	chain: ReadonlyArray<string>,
): Effect.Effect<ReadChain, MarkdownlintConfigError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const config = yield* readOne(file);
		const reference = config.extends;
		// markdownlint follows a truthy `extends` only, and leaves a falsy one in place.
		if (!reference) return { config, files: [file] };
		if (!Predicate.isString(reference)) {
			return yield* fail("parse", file, { detail: "extends is not a string" });
		}
		const target = path.resolve(path.dirname(file), reference);
		const visited = [...chain, file];
		if (visited.includes(target)) {
			return yield* fail("extends-cycle", target, { detail: [...visited, target].join(" -> ") });
		}
		if (visited.length > MAX_EXTENDS_DEPTH) {
			return yield* fail("extends-depth", target, { detail: `more than ${MAX_EXTENDS_DEPTH} extends links` });
		}
		if (!isUnsupported(path.basename(target))) {
			const exists = yield* fs.exists(target).pipe(Effect.catch((cause) => fail("unreadable", target, { cause })));
			if (!exists) return yield* fail("extends-missing", target, { detail: `extended by "${file}"` });
		}
		const base = yield* readChain(target, visited);
		return { config: LintConfig.merge(base.config, config), files: [file, ...base.files] };
	});

/**
 * Reads markdownlint configuration files and resolves the configuration that
 * applies to a markdown file.
 *
 * @remarks
 * Requires `FileSystem` and `Path` in `R`. Every failure is a
 * {@link MarkdownlintConfigError}.
 *
 * @example
 * ```ts
 * import { MarkdownlintConfigFile } from "@effected/markdown-lint/config";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 * 	const resolved = yield* MarkdownlintConfigFile.resolve("/repo/docs/guide.md", { root: "/repo" });
 * 	return resolved.config;
 * });
 * ```
 *
 * @public
 */
export class MarkdownlintConfigFile {
	private constructor() {}

	/**
	 * Read one configuration file and follow its `extends` chain, merging each
	 * file over the one it extends (markdownlint's shallow merge) and dropping
	 * `extends`. An `extends` path is relative to the extending file's
	 * directory, or absolute.
	 */
	static readonly read = Effect.fn("MarkdownlintConfigFile.read")(function* (path: string) {
		const paths = yield* Path.Path;
		const resolved = yield* readChain(paths.resolve(path), []);
		return resolved.config;
	});

	/**
	 * Resolve the configuration for the markdown file at `filePath`: walk from
	 * its directory up to `options.root`, inclusive, and read the first
	 * directory's supported config file. A directory holding only unsupported
	 * files is recorded in `skipped` and passed over. With no config found,
	 * `config` is `{}`. A `filePath` outside the root fails `unreadable`.
	 */
	static readonly resolve = Effect.fn("MarkdownlintConfigFile.resolve")(function* (
		filePath: string,
		options: { readonly root: string },
	) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = path.resolve(options.root);
		const file = path.resolve(filePath);
		const relative = path.relative(root, file);
		if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			return yield* fail("unreadable", file, { detail: `outside the root "${root}"` });
		}
		const exists = (candidate: string) =>
			fs.exists(candidate).pipe(Effect.catch((cause) => fail("unreadable", candidate, { cause })));
		const skipped: Array<string> = [];
		let directory = path.dirname(file);
		while (true) {
			for (const name of SUPPORTED_NAMES) {
				const candidate = path.join(directory, name);
				if (yield* exists(candidate)) {
					const resolved = yield* readChain(candidate, []);
					return { config: resolved.config, files: resolved.files, skipped } satisfies ResolvedLintConfig;
				}
			}
			for (const name of UNSUPPORTED_NAMES) {
				const candidate = path.join(directory, name);
				if (yield* exists(candidate)) skipped.push(candidate);
			}
			if (directory === root) break;
			directory = path.dirname(directory);
		}
		return { config: {}, files: [], skipped } satisfies ResolvedLintConfig;
	});
}
