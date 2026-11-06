import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Effect, Result, Schema } from "effect";
import { rolldown } from "rolldown";
import type { ActionConfig } from "../config/ActionConfig.js";
import { causeMessage } from "../internal/causeMessage.js";
import { BundleFailed, CleanError, WriteError } from "./ActionErrors.js";
import { DEFAULT_LIFECYCLE_ENTRIES, invalidWorkerName } from "./entries.js";
import { ignoreStubPlugin } from "./ignore-stub-plugin.js";
import { checkImport } from "./import-check.js";

/**
 * What one bundle came to.
 *
 * @public
 */
export class BundleStats extends Schema.Class<BundleStats>("BundleStats")({
	/** The entry: `main`, `pre`, `post` or a worker's name. */
	entry: Schema.String,
	/** The bundle's size in bytes. */
	size: Schema.Number,
	/** How long the entry took to bundle and check, in milliseconds. */
	duration: Schema.Number,
	/** The output path, relative to the action. */
	outputPath: Schema.String,
}) {}

/**
 * How one entry's bundling went.
 *
 * @public
 */
export class BundleResult extends Schema.Class<BundleResult>("BundleResult")({
	/** Whether the entry bundled and its bundle loaded. */
	success: Schema.Boolean,
	/** The bundle's statistics, on success. */
	stats: Schema.optionalKey(BundleStats),
	/** What went wrong, on failure. */
	error: Schema.optionalKey(Schema.String),
	/** The warnings rolldown logged for this entry, when it logged any. */
	warnings: Schema.optionalKey(Schema.Array(Schema.String)),
}) {}

/**
 * How a whole action bundle went.
 *
 * @public
 */
export class BuildResult extends Schema.Class<BuildResult>("BuildResult")({
	/** Whether every entry succeeded. */
	success: Schema.Boolean,
	/** Each entry's result: `main`, `pre`, `post`, then the workers. */
	entries: Schema.Array(BundleResult),
	/** How long the build took, in milliseconds. */
	duration: Schema.Number,
	/** A summary of what went wrong, on failure. */
	error: Schema.optionalKey(Schema.String),
}) {}

interface EntryToBuild {
	readonly name: string;
	readonly source: string;
}

/**
 * The entries to build. A `pre` or `post` the config names must exist, and the conventional `src/pre.ts` and
 * `src/post.ts` are built when they do.
 */
const entriesToBuild = (
	config: ActionConfig,
	cwd: string,
): Result.Result<ReadonlyArray<EntryToBuild>, BundleFailed> => {
	const { main, pre, post, workers } = config.entries;
	const mainSource = resolve(cwd, main);
	if (!existsSync(mainSource)) {
		return Result.fail(new BundleFailed({ entry: main, cause: new Error("Main entry point not found") }));
	}
	const entries: Array<EntryToBuild> = [{ name: "main", source: mainSource }];
	for (const [name, explicit, fallback] of [
		["pre", pre, DEFAULT_LIFECYCLE_ENTRIES.pre],
		["post", post, DEFAULT_LIFECYCLE_ENTRIES.post],
	] as const) {
		const source = resolve(cwd, explicit ?? fallback);
		if (existsSync(source)) entries.push({ name, source });
		else if (explicit !== undefined) {
			return Result.fail(new BundleFailed({ entry: name, cause: new Error(`Entry point not found: ${explicit}`) }));
		}
	}
	for (const [name, source] of Object.entries(workers)) {
		const reason = invalidWorkerName(name);
		if (reason !== undefined) return Result.fail(new BundleFailed({ entry: name, cause: new Error(reason) }));
		const workerSource = resolve(cwd, source);
		if (!existsSync(workerSource)) {
			return Result.fail(
				new BundleFailed({ entry: name, cause: new Error(`Worker entry point not found: ${source}`) }),
			);
		}
		entries.push({ name, source: workerSource });
	}
	return Result.succeed(entries);
};

/** Bundles one entry and, unless the config turns it off, proves the bundle loads. A failure comes back as a result. */
const bundleEntry = async (
	entry: EntryToBuild,
	config: ActionConfig,
	cwd: string,
	signal: AbortSignal,
): Promise<BundleResult> => {
	const started = Date.now();
	const { minify, sourceMap, externals, ignore, importCheck } = config.build;
	const warnings: Array<string> = [];
	const logged = () => (warnings.length > 0 ? { warnings } : {});
	try {
		const build = await rolldown({
			input: { [entry.name]: entry.source },
			cwd,
			platform: "node",
			treeshake: true,
			// A module in both lists is stubbed: the ignore plugin only sees what is not external.
			external: [/^node:/, ...externals.filter((name) => !ignore.includes(name))],
			// Rolldown's node default leads with `main`, which takes a UMD build whose factory receives `require` as a
			// value. Its relative requires then stay runtime calls, so the bundle cannot load, and the build reports nothing.
			resolve: { mainFields: ["module", "main"] },
			transform: {
				define: {
					// A bundled CommonJS module may read these. Rolldown leaves them bare, and they throw when reached.
					__dirname: "import.meta.dirname",
					__filename: "import.meta.filename",
					"process.env.NODE_ENV": '"production"',
				},
			},
			plugins: [ignoreStubPlugin(ignore)],
			onLog(level, log) {
				if (level === "warn") warnings.push(stripVTControlCharacters(log.message));
			},
		});
		try {
			await build.write({
				dir: join(cwd, "dist"),
				format: "esm",
				entryFileNames: "[name].js",
				minify,
				sourcemap: sourceMap,
				// One file per entry: a dynamic import of a static path folds into its parent.
				codeSplitting: false,
				comments: { legal: true, annotation: false, jsdoc: false },
			});
		} finally {
			await build.close();
		}

		const file = join(cwd, "dist", `${entry.name}.js`);
		if (importCheck) {
			const verdict = await checkImport(file, { externals, signal });
			if (verdict.kind === "failed") {
				return BundleResult.make({
					success: false,
					error: `${entry.name} does not load: ${verdict.message}`,
					...logged(),
				});
			}
			if (verdict.kind === "external-missing") {
				warnings.push(
					`${verdict.packageName} is in build.externals and is not installed, so the load check stopped there`,
				);
			}
		}
		return BundleResult.make({
			success: true,
			stats: BundleStats.make({
				entry: entry.name,
				size: statSync(file).size,
				duration: Date.now() - started,
				outputPath: `dist/${entry.name}.js`,
			}),
			...logged(),
		});
	} catch (cause) {
		return BundleResult.make({
			success: false,
			error: `${entry.name} failed to bundle: ${causeMessage(cause) ?? String(cause)}`,
			...logged(),
		});
	}
};

/**
 * Bundles a GitHub Action with rolldown.
 *
 * @public
 */
export class ActionBundle {
	private constructor() {}

	/**
	 * Bundles every entry of the action at `options.cwd` into its own `dist/<entry>.js`, and writes `dist/package.json`
	 * so Node reads them as ESM.
	 *
	 * @remarks
	 * Each bundle is self-contained apart from `node:` builtins and `build.externals`, and the output does not depend
	 * on when or where it is built.
	 *
	 * Each bundle is then imported in a fresh Node, because a bundle can build cleanly and not load. Set
	 * `build.importCheck = false` to skip that. The child has no `GITHUB_*` variable, token or `PATH`, and runs in a
	 * temporary directory, for at most a minute. An action's `GITHUB_ACTIONS` guard stays closed, but an action with no
	 * guard runs for real there. A failure asking for an input passes. A package listed in `build.externals` that is not
	 * installed passes with a warning on the entry, and the check learns nothing about the bundle past that import.
	 *
	 * An entry that fails to bundle or load is reported in the result with the others still built, and leaves no bundle
	 * in `dist`. A missing `main`, a `pre`, `post` or worker the config names with no file, and a bad worker name fail
	 * {@link BundleFailed} before `dist` is touched. Interrupting the build kills a running load check.
	 *
	 * @param options - `cwd` is the action's directory; `clean` removes `dist` first.
	 */
	static readonly build: (
		config: ActionConfig,
		options: { readonly cwd: string; readonly clean: boolean },
	) => Effect.Effect<BuildResult, BundleFailed | CleanError | WriteError> = Effect.fn("ActionBundle.build")(function* (
		config: ActionConfig,
		options: { readonly cwd: string; readonly clean: boolean },
	) {
		const started = Date.now();
		// Rolldown names modules relative to its cwd in unminified output, and a module's id is always a real path, so a
		// cwd reached through a symlink would write the machine's directory layout into the bundle.
		const requested = resolve(options.cwd);
		const cwd = existsSync(requested) ? realpathSync(requested) : requested;
		const dist = join(cwd, "dist");
		const entries = yield* Effect.fromResult(entriesToBuild(config, cwd));

		if (options.clean) {
			yield* Effect.try({
				try: () => rmSync(dist, { recursive: true, force: true }),
				catch: (cause) => new CleanError({ directory: dist, cause }),
			});
		}
		const manifest = join(dist, "package.json");
		yield* Effect.try({
			try: () => {
				mkdirSync(dist, { recursive: true });
				writeFileSync(manifest, '{ "type": "module" }', "utf8");
			},
			catch: (cause) => new WriteError({ path: manifest, cause }),
		});

		const results: Array<BundleResult> = [];
		for (const entry of entries) {
			const result = yield* Effect.promise((signal) => bundleEntry(entry, config, cwd, signal));
			if (!result.success) {
				yield* Effect.try({
					try: () => {
						rmSync(join(dist, `${entry.name}.js`), { force: true });
						rmSync(join(dist, `${entry.name}.js.map`), { force: true });
					},
					catch: (cause) => new CleanError({ directory: dist, cause }),
				});
			}
			results.push(result);
		}

		const failed = results.filter((result) => !result.success).length;
		return BuildResult.make({
			success: failed === 0,
			entries: results,
			duration: Date.now() - started,
			...(failed > 0 ? { error: `${failed} of ${results.length} entries failed to build` } : {}),
		});
	});
}
