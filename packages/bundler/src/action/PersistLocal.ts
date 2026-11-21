import { AtomicDirectory, AtomicFile } from "@effected/files";
import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { ActionYmlPathError, PersistLocalError } from "./ActionErrors.js";
import type { ResolvedPersist } from "./PersistTarget.js";
import { within } from "./PersistTarget.js";
import { sameBytes, walkEntries } from "./tree.js";

/**
 * What a persist did.
 *
 * @public
 */
export class PersistLocalResult extends Schema.Class<PersistLocalResult>("PersistLocalResult")({
	/** Files written that were new or changed. */
	filesCopied: Schema.Number,
	/** Files that already matched the persisted copy. */
	filesSkipped: Schema.Number,
	/** Whether an act template file was generated. */
	actTemplateGenerated: Schema.Boolean,
	/** Act template files not written because their real path cannot be resolved or is outside the workspace. */
	actTemplateSkipped: Schema.Array(Schema.String),
	/** The local action directory. */
	outputPath: Schema.String,
}) {}

const ACTRC_CONTENT = `--container-architecture linux/amd64
-W .github/workflows/act-test.yml
`;

/** The act workflow. The step's path is a quoted scalar (JSON is YAML), so a `#` or `: ` in it is not misread. */
const actWorkflowContent = (actionPath: string): string => `name: Local Test
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ${JSON.stringify(`./${actionPath}`)}
`;

/** Fails when a `runs` path in the persisted `action.yml` names no persisted file. */
const checkRunsPaths = Effect.fnUntraced(function* (actionYml: string, outputPath: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (!(yield* fs.exists(actionYml))) return;
	const parsed = Yaml.parseResult(yield* fs.readFileString(actionYml));
	if (Result.isFailure(parsed)) return;
	const runs = (parsed.success as { readonly runs?: unknown } | null)?.runs as
		| Readonly<Record<string, unknown>>
		| null
		| undefined;
	if (runs === undefined || runs === null) return;
	for (const entryType of ["main", "pre", "post"]) {
		const specifiedPath = runs[entryType];
		if (typeof specifiedPath !== "string" || specifiedPath.length === 0) continue;
		const expectedPath = path.resolve(outputPath, specifiedPath);
		if (!(yield* fs.exists(expectedPath))) {
			return yield* new ActionYmlPathError({ entryType, specifiedPath, expectedPath });
		}
	}
});

/** The entry's own type, without following a link; `None` when nothing is there. */
const entryType = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.lstat(file).pipe(
			Effect.map((info) => Option.some(info.type)),
			Effect.catchTag("PlatformError", (error) =>
				error.reason._tag === "NotFound" ? Effect.succeed(Option.none()) : Effect.fail(error),
			),
		);
	});

/**
 * Where `file` really lands: its deepest existing ancestor realpathed, with the missing tail put back, as
 * `PersistTarget.resolve` does for the output path. `None` when that ancestor cannot be realpathed (a dangling link).
 */
const realDestination = Effect.fnUntraced(function* (file: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	let existing = path.dirname(file);
	const tail: Array<string> = [path.basename(file)];
	while (existing !== path.dirname(existing) && Option.isNone(yield* entryType(existing))) {
		tail.unshift(path.basename(existing));
		existing = path.dirname(existing);
	}
	const real = yield* Effect.option(fs.realPath(existing));
	return Option.map(real, (directory) => path.join(directory, ...tail));
});

type TemplateOutcome = "written" | "present" | "outside";

/**
 * Writes `content` at `file` when nothing is there, never through a link. Any entry at `file`, a dangling link
 * included, is present and not ours. A `file` whose real path leaves `root` is not written.
 */
const writeTemplate = Effect.fnUntraced(function* (file: string, content: string, root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const destination = yield* realDestination(file);
	if (Option.isNone(destination) || !within(path, root, destination.value)) return "outside" as TemplateOutcome;
	if (Option.isSome(yield* entryType(destination.value))) return "present" as TemplateOutcome;
	yield* fs.makeDirectory(path.dirname(destination.value), { recursive: true });
	yield* AtomicFile.write(destination.value, content, { links: "replace" });
	return "written" as TemplateOutcome;
});

/** The regular files of a persisted `dist`, by relative path; a link, or a `dist` that is one, is never read through. */
const persistedFiles = Effect.fnUntraced(function* (dist: string) {
	const types = yield* entryType(dist);
	if (Option.isNone(types) || types.value !== "Directory") return new Set<string>();
	const entries = yield* walkEntries(dist, dist);
	return new Set(entries.filter((entry) => !entry.symlink).map((entry) => entry.path));
});

/**
 * Copies an action's build to a local action directory, for testing with nektos/act.
 *
 * @public
 */
export class PersistLocal {
	private constructor() {}

	/**
	 * Makes the resolved output directory hold the action's `action.yml` and `dist/`, and generates the act template.
	 *
	 * @remarks
	 * It writes nothing when the target is not enabled. `dist/` is persisted first, so a failed dist write never leaves
	 * a new `action.yml` beside the old `dist/`. It is replaced whole with `AtomicDirectory.write`, from `distDir`: the
	 * package's own `dist/`, or the staging directory when the package keeps none. A reader sees the old tree, the new
	 * one, or briefly none, never a partial one; a failure between its two renames leaves `dist` absent until the next
	 * persist restores it. A failed removal of the old tree after the new one is live only logs a warning. `action.yml`
	 * is then written with `AtomicFile.write`. A symlink at either path is replaced, never followed. Everything else in the persisted
	 * directory, a committed README for one, is left alone. `filesCopied` and `filesSkipped` count the files that were
	 * new or changed and those that already matched. The act template is rooted at `target.actRoot`, and its step uses
	 * the persisted directory relative to it. A `.actrc` or `.github/workflows/act-test.yml` is written only when nothing
	 * is at its path, a dangling link included, and only when its real path (its deepest existing ancestor realpathed)
	 * stays inside the workspace; one that would leave it is skipped with a warning and listed in `actTemplateSkipped`.
	 * A `runs` path in `action.yml` that names no persisted file fails {@link ActionYmlPathError}.
	 *
	 * @param target - Where to persist, from {@link PersistTarget.resolve}.
	 * @param options - `cwd` is the action's directory and `distDir` is where its bundles are.
	 */
	static readonly persist: (
		target: ResolvedPersist,
		options: { readonly cwd: string; readonly distDir: string },
	) => Effect.Effect<PersistLocalResult, PersistLocalError | ActionYmlPathError, FileSystem.FileSystem | Path.Path> =
		Effect.fn("PersistLocal.persist")(function* (
			target: ResolvedPersist,
			options: { readonly cwd: string; readonly distDir: string },
		) {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const { enabled, actTemplate, outputPath } = target;
			if (!enabled) {
				return PersistLocalResult.make({
					filesCopied: 0,
					filesSkipped: 0,
					actTemplateGenerated: false,
					actTemplateSkipped: [],
					outputPath,
				});
			}
			const failingAt = (at: string) =>
				Effect.mapError((cause: PlatformError.PlatformError) => new PersistLocalError({ path: at, cause }));

			yield* fs.makeDirectory(outputPath, { recursive: true }).pipe(failingAt(outputPath));

			let filesCopied = 0;
			let filesSkipped = 0;

			const dist = options.distDir;
			const hasDist = yield* Effect.gen(function* () {
				return (yield* fs.exists(dist)) && (yield* fs.stat(dist)).type === "Directory";
			}).pipe(failingAt(dist));
			if (hasDist) {
				const persistedDist = path.resolve(outputPath, "dist");
				const files = yield* Effect.gen(function* () {
					const before = yield* persistedFiles(persistedDist);
					const read: Array<readonly [string, Uint8Array]> = [];
					for (const entry of yield* walkEntries(dist, dist)) {
						const bytes = yield* fs.readFile(path.join(dist, entry.path));
						const unchanged =
							before.has(entry.path) && sameBytes(bytes, yield* fs.readFile(path.join(persistedDist, entry.path)));
						if (unchanged) filesSkipped++;
						else filesCopied++;
						read.push([entry.path, bytes]);
					}
					return read;
				}).pipe(failingAt(dist));
				// Only dist/ is replaced, whole (old, new, or briefly none, never partial): a link there is replaced rather
				// than followed, and anything else in the persisted directory is left alone. A failed cleanup of the old
				// tree leaves the new one live, so it is a warning, not a failure.
				yield* AtomicDirectory.write(persistedDist, files).pipe(
					Effect.catchTag("AtomicDirectoryError", (cause) =>
						cause.operation === "cleanup"
							? Effect.logWarning(`Persisted ${persistedDist}, but could not remove the old tree: ${cause.message}`)
							: Effect.fail(new PersistLocalError({ path: persistedDist, cause })),
					),
				);
			}

			const actionYml = path.resolve(options.cwd, "action.yml");
			const persistedActionYml = path.resolve(outputPath, "action.yml");
			if (yield* fs.exists(actionYml).pipe(failingAt(actionYml))) {
				const unchanged = yield* Effect.gen(function* () {
					const types = yield* entryType(persistedActionYml);
					if (Option.isNone(types) || types.value !== "File") return false;
					return sameBytes(yield* fs.readFile(actionYml), yield* fs.readFile(persistedActionYml));
				}).pipe(failingAt(actionYml));
				if (unchanged) filesSkipped++;
				else {
					const content = yield* fs.readFile(actionYml).pipe(failingAt(actionYml));
					// "replace": a committed link at the persisted path is swapped for a file, never written through.
					yield* AtomicFile.write(persistedActionYml, content, { links: "replace" }).pipe(failingAt(actionYml));
					filesCopied++;
				}
			} else {
				yield* fs.remove(persistedActionYml, { force: true }).pipe(failingAt(persistedActionYml));
			}

			yield* checkRunsPaths(persistedActionYml, outputPath).pipe(
				Effect.catchTag("PlatformError", (cause) =>
					Effect.fail(new PersistLocalError({ path: persistedActionYml, cause })),
				),
			);

			let actTemplateGenerated = false;
			const actTemplateSkipped: Array<string> = [];
			if (actTemplate) {
				const actionPath = path.relative(target.actRoot, outputPath).split(path.sep).join("/");
				const templates = [
					[path.resolve(target.actRoot, ".actrc"), ACTRC_CONTENT],
					[path.resolve(target.actRoot, ".github/workflows/act-test.yml"), actWorkflowContent(actionPath)],
				] as const;
				for (const [file, content] of templates) {
					const outcome = yield* writeTemplate(file, content, target.root).pipe(failingAt(file));
					if (outcome === "written") actTemplateGenerated = true;
					if (outcome === "outside") {
						actTemplateSkipped.push(file);
						yield* Effect.logWarning(
							`Skipped the act template ${file}: it cannot be resolved or is outside the workspace`,
						);
					}
				}
			}

			return PersistLocalResult.make({
				filesCopied,
				filesSkipped,
				actTemplateGenerated,
				actTemplateSkipped,
				outputPath,
			});
		});
}
