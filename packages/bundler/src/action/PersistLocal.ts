import { Yaml } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import type { ActionConfig } from "../config/ActionConfig.js";
import { ActionYmlPathError, PersistLocalError } from "./ActionErrors.js";

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

const ACT_WORKFLOW_CONTENT = `name: Local Test
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/local
`;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Copies `from` over `to` unless they already match, and says whether it copied. */
const syncFile = Effect.fnUntraced(function* (from: string, to: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if ((yield* fs.exists(to)) && sameBytes(yield* fs.readFile(from), yield* fs.readFile(to))) return false;
	yield* fs.makeDirectory(path.dirname(to), { recursive: true });
	yield* fs.copyFile(from, to);
	return true;
});

/** Every file under `directory`, relative to `base`. */
const walk = (
	directory: string,
	base: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!(yield* fs.exists(directory))) return [];
		const files: Array<string> = [];
		for (const name of yield* fs.readDirectory(directory)) {
			const full = path.join(directory, name);
			if ((yield* fs.stat(full)).type === "Directory") files.push(...(yield* walk(full, base)));
			else files.push(path.relative(base, full));
		}
		return files;
	});

/** Removes a file and each parent up to `root` that it leaves empty. */
const removeStale = Effect.fnUntraced(function* (file: string, root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* fs.remove(file, { force: true });
	let parent = path.dirname(file);
	while (parent !== root && (yield* fs.exists(parent)) && (yield* fs.readDirectory(parent)).length === 0) {
		yield* fs.remove(parent, { recursive: true });
		parent = path.dirname(parent);
	}
});

/** Makes `to` match `from`: copies what is new or changed, and removes what `from` no longer has. */
const syncDirectory = Effect.fnUntraced(function* (from: string, to: string) {
	const path = yield* Path.Path;
	const sourceFiles = yield* walk(from, from);
	let copied = 0;
	let skipped = 0;
	for (const file of sourceFiles) {
		if (yield* syncFile(path.join(from, file), path.join(to, file))) copied++;
		else skipped++;
	}
	const sources = new Set(sourceFiles);
	for (const file of yield* walk(to, to)) {
		if (!sources.has(file)) yield* removeStale(path.join(to, file), to);
	}
	return { copied, skipped };
});

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
	 * Makes `persistLocal.path` hold the action's `action.yml` and `dist/`, and generates the act template.
	 *
	 * @remarks
	 * It writes nothing when `persistLocal.enabled` is false. Files that match are left alone, and files the source no
	 * longer has are removed. A `.actrc` and `.github/workflows/act-test.yml` that already exist are kept. A `runs` path
	 * in `action.yml` that names no persisted file fails {@link ActionYmlPathError}.
	 *
	 * @param options - `cwd` is the action's directory.
	 */
	static readonly persist: (
		config: ActionConfig,
		options: { readonly cwd: string },
	) => Effect.Effect<PersistLocalResult, PersistLocalError | ActionYmlPathError, FileSystem.FileSystem | Path.Path> =
		Effect.fn("PersistLocal.persist")(function* (config: ActionConfig, options: { readonly cwd: string }) {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const { enabled, actTemplate } = config.persistLocal;
			const outputPath = path.resolve(options.cwd, config.persistLocal.path);
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

			const dist = path.resolve(options.cwd, "dist");
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
				const actrc = path.resolve(options.cwd, ".actrc");
				const workflow = path.resolve(options.cwd, ".github/workflows/act-test.yml");
				if (yield* writeIfAbsent(actrc, ACTRC_CONTENT).pipe(failingAt(actrc))) actTemplateGenerated = true;
				if (yield* writeIfAbsent(workflow, ACT_WORKFLOW_CONTENT).pipe(failingAt(workflow))) actTemplateGenerated = true;
			}

			return PersistLocalResult.make({ filesCopied, filesSkipped, actTemplateGenerated, outputPath });
		});
}
