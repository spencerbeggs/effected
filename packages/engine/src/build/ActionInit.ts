// The shared body of `effected action init` and the MCP's `action_init`: plan a new GitHub Action's files as data, then
// write them, refusing to overwrite. Exit codes and rendering stay with the front ends.

import { EffectedConfigSchema } from "@effected/bundler";
import { AtomicFile } from "@effected/files";
import { ErrorText, PathContainment } from "@effected/kit";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Predicate, Result, Schema } from "effect";
import { NotAPackageError } from "./BuildRun.js";

/**
 * One file of a scaffold: where it goes, relative to the action's directory, and its whole content.
 *
 * @public
 */
export class ActionScaffoldFile extends Schema.Class<ActionScaffoldFile>("ActionScaffoldFile")({
	/** The path, relative to the action's directory, with `/` separators. */
	path: Schema.String,
	/** The complete content. */
	contents: Schema.String,
}) {}

/**
 * Everything a new action needs that `action init` writes, as data: the files, and the packages its source imports.
 *
 * @public
 */
export class ActionScaffold extends Schema.Class<ActionScaffold>("ActionScaffold")({
	/** The files, in the order they are written. */
	files: Schema.Array(ActionScaffoldFile),
	/** The runtime packages the scaffold's source imports, closed over their required peers. */
	dependencies: Schema.Array(Schema.String),
	/** The packages the scaffold's tooling needs: the `effected` command and the tsconfig preset it extends. */
	devDependencies: Schema.Array(Schema.String),
}) {}

/**
 * What one `action init` did.
 *
 * @public
 */
export class ActionInitResult extends Schema.Class<ActionInitResult>("ActionInitResult")({
	/** The action's directory. */
	cwd: Schema.String,
	/** Every file written, relative to `cwd`, in the order written. */
	written: Schema.Array(Schema.String),
	/** The files among `written` that existed and were replaced, which only `force` allows. */
	overwritten: Schema.Array(Schema.String),
	/** Runtime packages the scaffold imports that `package.json` does not declare yet. */
	missingDependencies: Schema.Array(Schema.String),
	/** Tooling packages the scaffold needs that `package.json` does not declare yet. */
	missingDevDependencies: Schema.Array(Schema.String),
	/** Whether `package.json` sets `"type": "module"`, which the entry's top-level `await` needs. */
	typeModule: Schema.Boolean,
}) {}

/**
 * The files a scaffold would write already exist, and overwriting was not asked for. Nothing was written.
 *
 * @public
 */
export class ScaffoldExistsError extends Schema.TaggedError<ScaffoldExistsError>()("ScaffoldExistsError", {
	/** The action's directory. */
	cwd: Schema.String,
	/** The existing files, relative to `cwd`. */
	files: Schema.Array(Schema.String),
}) {
	override get message(): string {
		return `${this.cwd} already has ${this.files.join(", ")}: nothing was written, and overwriting needs force`;
	}
}

/**
 * One path a scaffold cannot be written over, whatever `force` says.
 *
 * @public
 */
export class ScaffoldConflict extends Schema.Class<ScaffoldConflict>("ScaffoldConflict")({
	/** The path, relative to the action's directory. */
	path: Schema.String,
	/**
	 * What is there: `symlink` a symbolic link, which is never followed or replaced; `not-a-file` a directory or other
	 * non-file where a file goes; `not-a-directory` a file where a directory goes; `unreadable` an entry that could not
	 * be inspected; `unwritable` an existing file or directory this process may not write (`.` is the action's directory
	 * itself); `escapes` a path that resolves outside the
	 * action's directory; `case-variant` an entry whose name differs from the scaffold's only in case.
	 */
	kind: Schema.Literals([
		"symlink",
		"not-a-file",
		"not-a-directory",
		"unreadable",
		"unwritable",
		"escapes",
		"case-variant",
	]),
}) {}

/**
 * Paths the scaffold would write cannot be written over: a symbolic link, the wrong kind of entry, an entry that could
 * not be inspected, or a path resolving outside the action's directory. Nothing was written, and `force` does not
 * change it.
 *
 * @public
 */
export class ScaffoldConflictError extends Schema.TaggedError<ScaffoldConflictError>()("ScaffoldConflictError", {
	/** The action's directory. */
	cwd: Schema.String,
	/** Each conflicting path and what is there. */
	conflicts: Schema.Array(ScaffoldConflict),
}) {
	override get message(): string {
		const listed = this.conflicts.map((conflict) => `${conflict.path} (${conflict.kind})`).join(", ");
		return `${this.cwd} cannot take the scaffold over ${listed}: nothing was written`;
	}
}

/**
 * A scaffold file or directory could not be written after every check passed. The files before it were written.
 *
 * @public
 */
export class ScaffoldWriteError extends Schema.TaggedError<ScaffoldWriteError>()("ScaffoldWriteError", {
	/** The action's directory. */
	cwd: Schema.String,
	/** The path that could not be written, relative to `cwd`. */
	path: Schema.String,
	/** The files written before it, relative to `cwd`, in order. */
	written: Schema.Array(Schema.String),
	/** The underlying filesystem failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const before = this.written.length > 0 ? this.written.join(", ") : "nothing";
		const cause = ErrorText.causeMessage(this.cause);
		return `Could not write ${this.path} in ${this.cwd}: ${cause}; already written: ${before}`;
	}
}

/**
 * The action's name or description was neither given nor found in `package.json`, or was blank.
 *
 * @public
 */
export class ActionMetadataMissingError extends Schema.TaggedError<ActionMetadataMissingError>()(
	"ActionMetadataMissingError",
	{
		/** Which `action.yml` field had no value. */
		field: Schema.Literals(["name", "description"]),
	},
) {
	override get message(): string {
		return `The action needs a ${this.field}: pass one, or set "${this.field}" in package.json`;
	}
}

/**
 * The action's name or description holds a control character or a lone surrogate, which `action.yml` cannot carry.
 *
 * @public
 */
export class ActionMetadataInvalidError extends Schema.TaggedError<ActionMetadataInvalidError>()(
	"ActionMetadataInvalidError",
	{
		/** Which `action.yml` field it was. */
		field: Schema.Literals(["name", "description"]),
		/** The first offending character or lone surrogate, as `U+XXXX`. */
		character: Schema.String,
	},
) {
	override get message(): string {
		const remedy = "write it on one line, as printable text";
		return `The action's ${this.field} holds ${this.character}, a control character or lone surrogate: ${remedy}`;
	}
}

/**
 * What the scaffold is built from: the two `action.yml` fields no default can supply.
 *
 * @public
 */
export interface ActionScaffoldInput {
	/** The action's display name. */
	readonly name: string;
	/** What the action does, one line. */
	readonly description: string;
}

/**
 * What one `action init` was asked to do, as the flags or tool parameters said it. A name or description left out is
 * read from `package.json`.
 *
 * @public
 */
export interface ActionInitInput {
	readonly name?: string;
	readonly description?: string;
	/** Replace files that already exist. */
	readonly force: boolean;
}

/**
 * What the process boundary supplies for `action init`.
 *
 * @public
 */
export interface ActionInitDeps {
	/** The action's directory, which must hold a `package.json`. */
	readonly cwd: string;
}

const DEPENDENCIES = ["@effected/github-actions", "effect", "@effect/platform-node"] as const;
// `@effected/plugin` carries the command and the tsconfig preset, and peers the other two, which the preset's
// `types: ["node"]` needs.
const DEV_DEPENDENCIES = ["@effected/plugin", "typescript", "@types/node"] as const;

// C0 except TAB, DEL and C1: YAML cannot print them, and a TAB is the one control a quoted scalar keeps.
const isControl = (code: number): boolean => (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);

const codePoint = (character: string): string =>
	`U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

// A JSON string is a YAML double-quoted scalar, so `:` and `#` stay text and JSON's escapes are YAML's. DEL, C1 and the
// line and paragraph separators, which JSON leaves raw, are escaped too, so the scalar holds printable YAML only.
const yamlString = (value: string): string =>
	JSON.stringify(value).replace(/[\u007F-\u009F\u2028\u2029]/g, (character) => `\\u${codePoint(character).slice(2)}`);

// The directive points tombi, taplo and other TOML editors at the published schema; tombi wants the blank line after it.
const effectedToml = `${EffectedConfigSchema.directive}

# \`effected action build\` reads the [action] tables. A key left out takes its default.

[action.entries]
main = "src/main.ts"

# Copies each build to .github/actions/local, the target act and CI smoke-test.
[action.persistLocal]
enabled = true
path = ".github/actions/local"
`;

const actionYml = (
	input: ActionScaffoldInput,
): string => `# The single source of the action's input and output names and their defaults: code mirrors them.
name: ${yamlString(input.name)}
description: ${yamlString(input.description)}
branding:
  icon: package
  color: blue
runs:
  using: node24
  main: dist/main.js
`;

const mainTs = `// The main entry: the program and the guard, nothing else. The guard keeps the program importable by tests, and the
// build's load check imports this bundle with GITHUB_ACTIONS unset, so it loads without running.
import { Action } from "@effected/github-actions";
import { program } from "./program.js";

if (process.env.GITHUB_ACTIONS) {
	await Action.run(program);
}
`;

const programTs = `// The program: read the inputs, run the steps in order, fold their results into the outputs, and report. Composition
// only: when it has steps, their bodies live in src/steps/, and every human-readable string in src/format.ts.
import { Effect } from "effect";

export const program = Effect.logInfo("The action ran.");
`;

const tsconfigJson = `{
	"$schema": "https://json.schemastore.org/tsconfig.json",
	"extends": "@effected/plugin/tsconfig/action.json"
}
`;

const blank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

const checked = (field: "name" | "description", value: string) => {
	// A lone surrogate is no character at all, and YAML has no escape that writes one.
	const found = [...value].find((character) => isControl(character.codePointAt(0) ?? 0) || !character.isWellFormed());
	return found === undefined
		? Effect.succeed(value.trim())
		: Effect.fail(new ActionMetadataInvalidError({ field, character: codePoint(found) }));
};

/** `package.json` as far as init reads it. */
interface Manifest {
	readonly name: string | undefined;
	readonly description: string | undefined;
	readonly declared: ReadonlySet<string>;
	readonly typeModule: boolean;
}

interface Json {
	readonly [key: PropertyKey]: unknown;
}

const stringField = (value: Json, key: string): string | undefined => {
	const field = value[key];
	return Predicate.isString(field) ? field : undefined;
};

const declaredIn = (value: Json, key: string): ReadonlyArray<string> => {
	const field = value[key];
	return Predicate.isObject(field) ? Object.keys(field) : [];
};

const readManifest = Effect.fnUntraced(function* (cwd: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const text = yield* fs
		.readFileString(path.join(cwd, "package.json"))
		.pipe(
			Effect.catchReason("PlatformError", "NotFound", () =>
				Effect.fail(new NotAPackageError({ cwd, reason: "it has no package.json" })),
			),
		);
	const parsed = yield* Effect.try({
		try: (): unknown => JSON.parse(text),
		catch: () => new NotAPackageError({ cwd, reason: "its package.json is not valid JSON" }),
	});
	if (!Predicate.isObject(parsed)) {
		return yield* new NotAPackageError({ cwd, reason: "its package.json is not an object" });
	}
	const name = stringField(parsed, "name");
	return {
		// A scope is npm's, not the action's: `@acme/greet` is the action `greet`.
		name: name === undefined ? undefined : name.replace(/^@[^/]+\//, ""),
		description: stringField(parsed, "description"),
		// A peer installs nothing, so only these two declare a package the scaffold needs installed.
		declared: new Set(["dependencies", "devDependencies"].flatMap((key) => declaredIn(parsed, key))),
		typeModule: stringField(parsed, "type") === "module",
	} satisfies Manifest;
});

/**
 * Scaffolds a new GitHub Action to the kit's canonical shape.
 *
 * @remarks
 * {@link ActionInit.plan} is pure: it answers the files as data. {@link ActionInit.write} puts a plan on disk, and
 * {@link ActionInit.run} is the front ends' one call, reading defaults from `package.json` first.
 *
 * @public
 */
export class ActionInit {
	private constructor() {}

	/**
	 * The scaffold for one action: the `[action]` tables of `effected.toml`, `action.yml`, the `main` entry, the program
	 * it runs, and a `tsconfig.json` extending the kit's preset.
	 *
	 * @remarks
	 * It has only a `main` phase and requires no token, so it builds and runs as it stands; `pre`, `post` and App
	 * authentication are added when the action needs them. The `action.yml` carries branding, because a missing one is a
	 * warning, and a warning fails a build under CI.
	 */
	static plan(input: ActionScaffoldInput): ActionScaffold {
		return ActionScaffold.make({
			files: [
				ActionScaffoldFile.make({ path: "effected.toml", contents: effectedToml }),
				ActionScaffoldFile.make({ path: "action.yml", contents: actionYml(input) }),
				ActionScaffoldFile.make({ path: "src/main.ts", contents: mainTs }),
				ActionScaffoldFile.make({ path: "src/program.ts", contents: programTs }),
				ActionScaffoldFile.make({ path: "tsconfig.json", contents: tsconfigJson }),
			],
			dependencies: DEPENDENCIES,
			devDependencies: DEV_DEPENDENCIES,
		});
	}

	/**
	 * Writes a scaffold under `cwd`.
	 *
	 * @remarks
	 * Every path is inspected with `lstat` before anything is written, so a refusal writes nothing:
	 *
	 * - A symbolic link at a file or at a directory the scaffold writes into is a {@link ScaffoldConflictError}, with or
	 *   without `force`. A link is never followed and never replaced, so no write can leave `cwd` through one.
	 * - So is a directory or other non-file where a file goes, a file where a directory goes, an entry that cannot be
	 *   inspected, and an existing file that cannot be written.
	 * - An existing regular file is a {@link ScaffoldExistsError} unless `force`, which replaces it.
	 *
	 * A name that differs from the scaffold's only in case (`Action.yml`) is a conflict too, and so is an existing directory,
	 * the action's own included, that this process may not write into.
	 *
	 * Then every directory is created and the files are written, each atomically and with a link at its path replaced
	 * rather than followed. Just before each write, the directories on its path are inspected again and the target is
	 * confirmed to resolve inside `cwd`. That is a point-in-time check: no committed link survives the pass above, but a
	 * concurrent local writer could still swap a directory for a link between the check and the write. Past the first
	 * check, a failure is {@link ScaffoldWriteError}, naming the path and the files already written.
	 *
	 * @returns The files written and the ones among them that were replaced.
	 */
	static readonly write: (
		scaffold: ActionScaffold,
		options: { readonly cwd: string; readonly force: boolean },
	) => Effect.Effect<
		{ readonly written: ReadonlyArray<string>; readonly overwritten: ReadonlyArray<string> },
		ScaffoldExistsError | ScaffoldConflictError | ScaffoldWriteError | PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("ActionInit.write")(function* (
		scaffold: ActionScaffold,
		options: { readonly cwd: string; readonly force: boolean },
	) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		// The directory itself is the caller's choice, so it is resolved once; nothing beneath it is followed.
		const root = yield* fs.realPath(path.resolve(options.cwd));
		const at = (relative: string) => path.join(root, ...relative.split("/"));

		const conflicts: Array<ScaffoldConflict> = [];
		const conflict = (relative: string, kind: ScaffoldConflict["kind"]) =>
			conflicts.push(ScaffoldConflict.make({ path: relative, kind }));
		/** The entry's type, `undefined` when nothing is there, or `null` when it could not be inspected. */
		const probe = (relative: string) =>
			Effect.map(Effect.result(fs.lstat(at(relative))), (info) =>
				Result.isSuccess(info) ? info.success.type : info.failure.reason._tag === "NotFound" ? undefined : null,
			);

		// Every directory a file goes into, shallowest first, and whether each must still be created.
		const directories = [
			...new Set(
				scaffold.files.flatMap((file) => {
					const segments = file.path.split("/").slice(0, -1);
					return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
				}),
			),
		].sort((a, b) => a.split("/").length - b.split("/").length);
		const blocked = new Set<string>();
		const create: Array<string> = [];
		const under = (paths: Iterable<string>, relative: string) =>
			[...paths].some((parent) => relative.startsWith(`${parent}/`));
		const parentOf = (relative: string) => relative.split("/").slice(0, -1).join("/");
		const basename = (relative: string) => relative.split("/").at(-1) ?? relative;

		// A directory's entries, read once: a name matched only in another case is the same entry on a case-insensitive
		// filesystem, and a different one beside it on a case-sensitive one, so neither is written over.
		const listings = new Map<string, ReadonlyArray<string> | null>();
		const listing = (relative: string) =>
			Effect.gen(function* () {
				const cached = listings.get(relative);
				if (cached !== undefined) return cached;
				const read = yield* Effect.result(fs.readDirectory(relative === "" ? root : at(relative)));
				const names = Result.isSuccess(read) ? read.success : null;
				listings.set(relative, names);
				return names;
			});
		const caseVariant = (relative: string) =>
			Effect.map(listing(parentOf(relative)), (names) => {
				const name = basename(relative);
				return (
					names !== null && !names.includes(name) && names.some((entry) => entry.toLowerCase() === name.toLowerCase())
				);
			});
		// Every existing directory a file goes into must take new entries, the init directory first.
		const writable = (relative: string) =>
			Effect.map(Effect.result(fs.access(relative === "" ? root : at(relative), { writable: true })), Result.isSuccess);

		if (!(yield* writable(""))) conflict(".", "unwritable");
		for (const directory of directories) {
			if (under(blocked, directory)) continue;
			if (under(create, directory)) {
				create.push(directory);
				continue;
			}
			if (yield* caseVariant(directory)) {
				blocked.add(directory);
				conflict(directory, "case-variant");
				continue;
			}
			const type = yield* probe(directory);
			if (type === undefined) create.push(directory);
			else if (type !== "Directory") {
				blocked.add(directory);
				conflict(directory, type === null ? "unreadable" : type === "SymbolicLink" ? "symlink" : "not-a-directory");
			} else if (!(yield* writable(directory))) {
				blocked.add(directory);
				conflict(directory, "unwritable");
			}
		}

		const existing: Array<string> = [];
		for (const file of scaffold.files) {
			if (under(blocked, file.path) || under(create, file.path)) continue;
			if (yield* caseVariant(file.path)) {
				conflict(file.path, "case-variant");
				continue;
			}
			const type = yield* probe(file.path);
			if (type === undefined) continue;
			if (type === "File") {
				const replaceable = yield* Effect.result(fs.access(at(file.path), { writable: true }));
				if (Result.isSuccess(replaceable)) existing.push(file.path);
				else conflict(file.path, "unwritable");
			} else {
				conflict(file.path, type === null ? "unreadable" : type === "SymbolicLink" ? "symlink" : "not-a-file");
			}
		}
		if (conflicts.length > 0) return yield* new ScaffoldConflictError({ cwd: root, conflicts });
		if (existing.length > 0 && !options.force) return yield* new ScaffoldExistsError({ cwd: root, files: existing });

		const written: Array<string> = [];
		const failed = (relative: string) => (cause: unknown) =>
			new ScaffoldWriteError({ cwd: root, path: relative, written: [...written], cause });
		for (const directory of create) {
			yield* fs.makeDirectory(at(directory)).pipe(Effect.mapError(failed(directory)));
		}

		// Checked again just before each write, a point-in-time check: no committed link reaches here, since the pass above
		// refused them all, but a concurrent local writer could still swap a directory for a link between this check and the
		// write it guards.
		const confined = (relative: string) =>
			Effect.gen(function* () {
				const segments = relative.split("/").slice(0, -1);
				for (let index = 1; index <= segments.length; index++) {
					if ((yield* probe(segments.slice(0, index).join("/"))) !== "Directory") return false;
				}
				return yield* PathContainment.isWithin(root, at(relative));
			});
		for (const file of scaffold.files) {
			if (!(yield* confined(file.path))) {
				return yield* failed(file.path)(
					new Error(`${file.path} no longer resolves inside ${root}: a directory on its path changed after the checks`),
				);
			}
			yield* AtomicFile.write(at(file.path), file.contents, { links: "replace" }).pipe(
				Effect.mapError(failed(file.path)),
			);
			written.push(file.path);
		}
		return { written, overwritten: existing };
	});

	/**
	 * Scaffolds the action in `deps.cwd`: reads `package.json` for the name and description not given, plans, and
	 * writes.
	 *
	 * @remarks
	 * The error channel holds a run that could not start or finish: a directory with no readable `package.json`, a name or
	 * description found nowhere or holding a control character, files that exist without `force`, a path that cannot be
	 * written over ({@link ScaffoldConflictError}), and a write that failed. It edits no `package.json`: the result names
	 * the packages to add.
	 */
	static readonly run: (
		input: ActionInitInput,
		deps: ActionInitDeps,
	) => Effect.Effect<
		ActionInitResult,
		| NotAPackageError
		| ActionMetadataMissingError
		| ActionMetadataInvalidError
		| ScaffoldExistsError
		| ScaffoldConflictError
		| ScaffoldWriteError
		| PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("ActionInit.run")(function* (input: ActionInitInput, deps: ActionInitDeps) {
		const path = yield* Path.Path;
		const cwd = path.resolve(deps.cwd);
		const manifest = yield* readManifest(cwd);

		const name = blank(input.name) ? manifest.name : input.name;
		if (blank(name)) return yield* new ActionMetadataMissingError({ field: "name" });
		const description = blank(input.description) ? manifest.description : input.description;
		if (blank(description)) return yield* new ActionMetadataMissingError({ field: "description" });

		const scaffold = ActionInit.plan({
			name: yield* checked("name", name ?? ""),
			description: yield* checked("description", description ?? ""),
		});
		const { written, overwritten } = yield* ActionInit.write(scaffold, { cwd, force: input.force });
		return ActionInitResult.make({
			cwd,
			written,
			overwritten,
			missingDependencies: scaffold.dependencies.filter((dependency) => !manifest.declared.has(dependency)),
			missingDevDependencies: scaffold.devDependencies.filter((dependency) => !manifest.declared.has(dependency)),
			typeModule: manifest.typeModule,
		});
	});
}
