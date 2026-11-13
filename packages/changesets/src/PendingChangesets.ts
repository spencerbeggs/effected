import { readFileSync, readdirSync } from "node:fs";
import { Effect, FileSystem, Path, PlatformError, Result, Schema } from "effect";
import { ReleaseType } from "./BumpType.js";
import { ChangesetFile } from "./ChangesetFile.js";
import { ChangesetParseError } from "./errors.js";
import type { Ledger } from "./Ledger.js";

/**
 * One pending changeset read from `.changeset/`.
 *
 * @public
 */
export class PendingChangeset extends Schema.Class<PendingChangeset>("PendingChangeset")({
	/**
	 * The file name, relative to `.changeset/`: `pre/<name>.md` for a
	 * changeset an earlier pre-release consumed.
	 */
	file: Schema.String,
	/** Package name to requested release type, in file order. */
	releases: Schema.ReadonlyMap(Schema.String, ReleaseType),
	/** The markdown after the front matter, trimmed as `@changesets/parse` trims it. */
	summary: Schema.String,
}) {
	/**
	 * The changeset's id, as `@changesets/read` gives it: `file` without
	 * `.md`, so `pre/<name>` for one an earlier pre-release consumed. A
	 * `PlannedRelease`'s `changesets` lists these.
	 */
	get id(): string {
		return this.file.replace(/\.md$/, "");
	}
}

/** The directory, under `.changeset/`, holding the changesets a pre-release consumed. */
const PRE = "pre";

const CONTEXT_FILES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

const isChangesetName = (name: string): boolean =>
	name.endsWith(".md") && !name.startsWith(".") && !/^README\.md$/i.test(name) && !CONTEXT_FILES.has(name);

const selectNames = (names: ReadonlyArray<string>): ReadonlyArray<string> => names.filter(isChangesetName).sort();

const withFile = (file: string, error: ChangesetParseError): ChangesetParseError =>
	new ChangesetParseError({ reason: error.reason, file, ...(error.line === undefined ? {} : { line: error.line }) });

const toPending = (file: string, text: string): Result.Result<PendingChangeset, ChangesetParseError> =>
	Result.match(ChangesetFile.parseSync(text), {
		onFailure: (error) => Result.fail(withFile(file, error)),
		onSuccess: (parsed) =>
			Result.succeed(PendingChangeset.make({ file, releases: parsed.releases, summary: parsed.summary })),
	});

const nodeErrorTag = (code: unknown): PlatformError.SystemErrorTag => {
	switch (code) {
		case "ENOENT":
			return "NotFound";
		case "EACCES":
		case "EPERM":
			return "PermissionDenied";
		case "EISDIR":
		case "ENOTDIR":
			return "BadResource";
		default:
			return "Unknown";
	}
};

const toPlatformError = (method: string, path: string, cause: unknown): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: nodeErrorTag((cause as { code?: unknown } | null)?.code),
		module: "PendingChangesets",
		method,
		pathOrDescriptor: path,
		cause,
	});

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === "NotFound";

/**
 * One changeset file {@link PendingChangesets.readSettled} could not read or
 * parse.
 *
 * @public
 */
export interface PendingChangesetFailure {
	/** The file name, relative to `.changeset/`, as a {@link PendingChangeset} names it. */
	readonly file: string;
	/** Why the file was skipped: it would not parse, or it would not read. */
	readonly error: ChangesetParseError | PlatformError.PlatformError;
}

/**
 * Every pending changeset that parsed, and every one that did not, from
 * {@link PendingChangesets.readSettled}.
 *
 * @public
 */
export interface SettledChangesets {
	/** The changesets that parsed, in the order {@link PendingChangesets.read} returns them. */
	readonly changesets: ReadonlyArray<PendingChangeset>;
	/** The files that did not, in the same order. */
	readonly failures: ReadonlyArray<PendingChangesetFailure>;
}

/** The changeset files under `.changeset/`, then those under `.changeset/pre/` as `pre/<name>.md`. */
const listFiles = Effect.fnUntraced(function* (dir: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const list = (directory: string) =>
		fs
			.readDirectory(directory)
			.pipe(Effect.catch((error) => (isNotFound(error) ? Effect.succeed([] as Array<string>) : Effect.fail(error))));
	const names = selectNames(yield* list(dir));
	const consumed = selectNames(yield* list(path.join(dir, PRE)));
	return [...names, ...consumed.map((name) => `${PRE}/${name}`)];
});

/** {@link listFiles} over `node:fs`; `dir` is the `.changeset` directory with no trailing separator. */
const listFilesSync = (dir: string): Result.Result<ReadonlyArray<string>, PlatformError.PlatformError> => {
	const list = (directory: string): Result.Result<ReadonlyArray<string>, PlatformError.PlatformError> => {
		try {
			return Result.succeed(selectNames(readdirSync(directory)));
		} catch (cause) {
			const error = toPlatformError("readDirectory", directory, cause);
			return isNotFound(error) ? Result.succeed([]) : Result.fail(error);
		}
	};
	const names = list(dir);
	if (Result.isFailure(names)) return Result.fail(names.failure);
	const consumed = list(`${dir}/${PRE}`);
	if (Result.isFailure(consumed)) return Result.fail(consumed.failure);
	return Result.succeed([...names.success, ...consumed.success.map((name) => `${PRE}/${name}`)]);
};

/** `<root>/.changeset`, trimming any run of trailing separators off `root`. */
const changesetDirSync = (root: string): string => {
	// A scan, not a `[\\/]+$` regex: the regex backtracks quadratically on a long separator run.
	let end = root.length;
	while (end > 0 && (root[end - 1] === "/" || root[end - 1] === "\\")) end--;
	return `${root.slice(0, end)}/.changeset`;
};

/** Read and parse one changeset file over `node:fs`. */
const readOneSync = (
	dir: string,
	file: string,
): Result.Result<PendingChangeset, ChangesetParseError | PlatformError.PlatformError> => {
	let text: string;
	try {
		text = readFileSync(`${dir}/${file}`, "utf8");
	} catch (cause) {
		return Result.fail(toPlatformError("readFile", `${dir}/${file}`, cause));
	}
	return toPending(file, text);
};

/**
 * Reading the pending changesets under a repository's `.changeset/`
 * directory.
 *
 * @public
 */
export class PendingChangesets {
	/**
	 * Read every pending changeset under `<root>/.changeset/`, ordered by file
	 * name, then those under `<root>/.changeset/pre/`, which a pre-release
	 * keeps after consuming them, as `pre/<name>.md`. A readme in any case,
	 * `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, dotfiles and non-`.md` files are
	 * skipped; a missing directory answers `[]`.
	 *
	 * The read is all or nothing: the first file that does not read or parse
	 * fails it. {@link PendingChangesets.readSettled} reads the same files and
	 * skips a bad one instead.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("PendingChangesets.read")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(root, ".changeset");
		const files = yield* listFiles(dir);
		return yield* Effect.forEach(files, (file) =>
			fs.readFileString(path.join(dir, file)).pipe(Effect.flatMap((text) => Effect.fromResult(toPending(file, text)))),
		);
	});

	/**
	 * The changesets still pending under pnpm's versioning, given its
	 * {@link Ledger}: pnpm leaves an intent file in place until every project
	 * it names has released, so each release key is dropped when the ledger
	 * records its project as having consumed this intent, and a changeset with
	 * no key left is dropped. A key starting `./` names a project by directory
	 * and is read with `Ledger.consumedDir`; any other is a package name. The
	 * order and the surviving keys are kept. Pure; the Changesets CLI has no
	 * ledger and does not use it.
	 *
	 * @param changesets - The changesets {@link PendingChangesets.read} returned.
	 * @param ledger - The ledger to read consumption from.
	 */
	static unconsumed(changesets: ReadonlyArray<PendingChangeset>, ledger: Ledger): ReadonlyArray<PendingChangeset> {
		const pending: Array<PendingChangeset> = [];
		for (const changeset of changesets) {
			const id = changeset.id;
			const releases = new Map(
				[...changeset.releases].filter(
					([key]) => !(key.startsWith("./") ? ledger.consumedDir(id, key) : ledger.consumed(id, key)),
				),
			);
			if (releases.size === 0) continue;
			pending.push(
				releases.size === changeset.releases.size
					? changeset
					: PendingChangeset.make({ file: changeset.file, releases, summary: changeset.summary }),
			);
		}
		return pending;
	}

	/**
	 * Read the same files as {@link PendingChangesets.read}, in the same order,
	 * but skip a file that does not read or parse and report it in `failures`
	 * rather than failing the whole read. For a best-effort view of pending
	 * bumps; a versioning tool wants the strict {@link PendingChangesets.read}.
	 *
	 * Listing `.changeset/` or `.changeset/pre/` still fails the effect with a
	 * `PlatformError`, since then no file is known to be missing; a missing
	 * directory answers no changesets and no failures.
	 *
	 * @param root - The repository root.
	 */
	static readonly readSettled = Effect.fn("PendingChangesets.readSettled")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(root, ".changeset");
		const files = yield* listFiles(dir);
		const changesets: Array<PendingChangeset> = [];
		const failures: Array<PendingChangesetFailure> = [];
		for (const file of files) {
			const result = yield* fs.readFileString(path.join(dir, file)).pipe(
				Effect.flatMap((text) => Effect.fromResult(toPending(file, text))),
				Effect.result,
			);
			if (Result.isSuccess(result)) changesets.push(result.success);
			else failures.push({ file, error: result.failure });
		}
		const settled: SettledChangesets = { changesets, failures };
		return settled;
	});

	/**
	 * Synchronous {@link PendingChangesets.read} over `node:fs`, for callers
	 * that run before any Effect runtime exists.
	 *
	 * @param root - The repository root.
	 */
	static readSync(
		root: string,
	): Result.Result<ReadonlyArray<PendingChangeset>, ChangesetParseError | PlatformError.PlatformError> {
		const dir = changesetDirSync(root);
		const files = listFilesSync(dir);
		if (Result.isFailure(files)) return Result.fail(files.failure);
		const pending: Array<PendingChangeset> = [];
		for (const file of files.success) {
			const parsed = readOneSync(dir, file);
			if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
			pending.push(parsed.success);
		}
		return Result.succeed(pending);
	}

	/**
	 * Synchronous {@link PendingChangesets.readSettled} over `node:fs`, for
	 * callers that run before any Effect runtime exists. Fails only when a
	 * directory cannot be listed.
	 *
	 * @param root - The repository root.
	 */
	static readSettledSync(root: string): Result.Result<SettledChangesets, PlatformError.PlatformError> {
		const dir = changesetDirSync(root);
		const files = listFilesSync(dir);
		if (Result.isFailure(files)) return Result.fail(files.failure);
		const changesets: Array<PendingChangeset> = [];
		const failures: Array<PendingChangesetFailure> = [];
		for (const file of files.success) {
			const parsed = readOneSync(dir, file);
			if (Result.isSuccess(parsed)) changesets.push(parsed.success);
			else failures.push({ file, error: parsed.failure });
		}
		return Result.succeed({ changesets, failures });
	}
}
