import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { ActionYmlPathError, PersistLocalError } from "./ActionErrors.js";
import type { ResolvedPersist } from "./PersistTarget.js";
import { syncDirectory, syncFile } from "./tree.js";

/**
 * What a persist did.
 *
 * @public
 */
export class PersistLocalResult extends Schema.Class<PersistLocalResult>("PersistLocalResult")({
	/** Files copied because they were new or changed. */
	filesCopied: Schema.Number,
	/** Files left alone because they matched. */
	filesSkipped: Schema.Number,
	/** Whether an act template file was generated. */
	actTemplateGenerated: Schema.Boolean,
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

/** Writes `content` at `file` unless the file exists, and says whether it wrote. */
const writeIfAbsent = Effect.fnUntraced(function* (file: string, content: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (yield* fs.exists(file)) return false;
	yield* fs.makeDirectory(path.dirname(file), { recursive: true });
	yield* fs.writeFileString(file, content);
	return true;
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
	 * It writes nothing when the target is not enabled. `dist/` is synced from `distDir`: the package's own `dist/`, or
	 * the staging directory when the package keeps none. The act template is rooted at `target.actRoot`, and its step
	 * uses the persisted directory relative to it. Files that match are left alone, and files the source no
	 * longer has are removed. A `.actrc` and `.github/workflows/act-test.yml` that already exist are kept. A `runs` path
	 * in `action.yml` that names no persisted file fails {@link ActionYmlPathError}.
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
				return PersistLocalResult.make({ filesCopied: 0, filesSkipped: 0, actTemplateGenerated: false, outputPath });
			}
			const failingAt = (at: string) =>
				Effect.mapError((cause: PlatformError.PlatformError) => new PersistLocalError({ path: at, cause }));

			yield* fs.makeDirectory(outputPath, { recursive: true }).pipe(failingAt(outputPath));

			let filesCopied = 0;
			let filesSkipped = 0;

			const actionYml = path.resolve(options.cwd, "action.yml");
			const persistedActionYml = path.resolve(outputPath, "action.yml");
			if (yield* fs.exists(actionYml).pipe(failingAt(actionYml))) {
				if (yield* syncFile(actionYml, persistedActionYml).pipe(failingAt(actionYml))) filesCopied++;
				else filesSkipped++;
			} else {
				yield* fs.remove(persistedActionYml, { force: true }).pipe(failingAt(persistedActionYml));
			}

			const dist = options.distDir;
			const hasDist = yield* Effect.gen(function* () {
				return (yield* fs.exists(dist)) && (yield* fs.stat(dist)).type === "Directory";
			}).pipe(failingAt(dist));
			if (hasDist) {
				const synced = yield* syncDirectory(dist, path.resolve(outputPath, "dist")).pipe(failingAt(dist));
				filesCopied += synced.copied;
				filesSkipped += synced.skipped;
			}

			yield* checkRunsPaths(persistedActionYml, outputPath).pipe(
				Effect.catchTag("PlatformError", (cause) =>
					Effect.fail(new PersistLocalError({ path: persistedActionYml, cause })),
				),
			);

			let actTemplateGenerated = false;
			if (actTemplate) {
				const actrc = path.resolve(target.actRoot, ".actrc");
				const workflow = path.resolve(target.actRoot, ".github/workflows/act-test.yml");
				const actionPath = path.relative(target.actRoot, outputPath).split(path.sep).join("/");
				if (yield* writeIfAbsent(actrc, ACTRC_CONTENT).pipe(failingAt(actrc))) actTemplateGenerated = true;
				if (yield* writeIfAbsent(workflow, actWorkflowContent(actionPath)).pipe(failingAt(workflow)))
					actTemplateGenerated = true;
			}

			return PersistLocalResult.make({ filesCopied, filesSkipped, actTemplateGenerated, outputPath });
		});
}
