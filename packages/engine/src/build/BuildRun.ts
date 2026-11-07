// The shared body of `effected package build` and the MCP's `package_build`: load the config and plugins, run the bundler,
// read its issues.json back, append to the workspace journals, and answer with a verdict. Exit codes and rendering
// stay with the front ends.

import type {
	BuildIssues,
	BuildReport,
	BundlerSeams,
	ConfigValidationError,
	EffectedConfigError,
	PassReport,
	PluginLoadError,
	ResolvedEffectedConfig,
} from "@effected/bundler";
import {
	BuildIssuesSchema,
	BuildJournal,
	Bundler,
	EffectedConfigError as EffectedConfigErrorClass,
	EffectedConfigFile,
	IssueJournal,
	flattenIssues,
	loadPlugins,
} from "@effected/bundler";
import type { AppendError, JournalWatcher } from "@effected/jsonl";
import { NodeJournalWatcher } from "@effected/jsonl/node";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import type { PlatformError } from "effect";
import {
	DateTime,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	PlatformError as PlatformErrorModule,
	Predicate,
	Schema,
} from "effect";
import { BuildRunResult } from "./BuildRunResult.js";

/**
 * The directory asked to build has no readable `package.json`.
 *
 * @public
 */
export class NotAPackageError extends Schema.TaggedError<NotAPackageError>()("NotAPackageError", {
	/** The directory. */
	cwd: Schema.String,
	/** What is wrong with its `package.json`. */
	reason: Schema.String,
}) {
	override get message(): string {
		return `${this.cwd} is not a package: ${this.reason}`;
	}
}

/**
 * What one build was asked to do, as the flags or tool parameters said it.
 *
 * @public
 */
export interface BuildRunInput {
	/** Skips the SEA compile. */
	readonly noExe: boolean;
	/** Measures gzip sizes for the report. */
	readonly verbose: boolean;
}

/**
 * Progress through one build.
 *
 * @remarks
 * `PassDone` is read from the report once the bundler returns, so a front end gets them together rather than as
 * each pass ends. A crashed build reports the passes it recorded before the crash.
 *
 * @public
 */
export type BuildProgress =
	| { readonly _tag: "Started"; readonly package: string; readonly config: ResolvedEffectedConfig }
	| { readonly _tag: "PassDone"; readonly pass: PassReport["id"]; readonly group: string }
	| { readonly _tag: "Done"; readonly issues: BuildIssues };

/**
 * What the process boundary supplies, and the test seams.
 *
 * @public
 */
export interface BuildRunDeps {
	/** The package directory; a relative path resolves against the process's. */
	readonly cwd: string;
	/** Whether this build runs under CI. */
	readonly ci: boolean;
	/** The plugin module importer; omitted, `loadPlugins`' `jiti` default. */
	readonly importModule?: (path: string) => Promise<unknown>;
	/** Replaces the bundler's side effects, for tests. */
	readonly seams?: Partial<BundlerSeams>;
	/** The journals' watcher; omitted, `NodeJournalWatcher.layer`. */
	readonly journalWatcher?: Layer.Layer<JournalWatcher>;
	/** Told when the build starts, of each pass and when it is done. */
	readonly onProgress?: (event: BuildProgress) => Effect.Effect<void>;
}

/** The name in the directory's `package.json`, or why it is not a package. */
export const readPackageName = Effect.fnUntraced(function* (cwd: string) {
	const fs = yield* FileSystem.FileSystem;
	const pathService = yield* Path.Path;
	const text = yield* fs
		.readFileString(pathService.join(cwd, "package.json"))
		.pipe(
			Effect.catchReason("PlatformError", "NotFound", () =>
				Effect.fail(new NotAPackageError({ cwd, reason: "it has no package.json" })),
			),
		);
	const manifest = yield* Effect.try({
		try: (): unknown => JSON.parse(text),
		catch: () => new NotAPackageError({ cwd, reason: "its package.json is not valid JSON" }),
	});
	return Predicate.hasProperty(manifest, "name") && Predicate.isString(manifest.name) ? manifest.name : "unknown";
});

/**
 * The workspace root above `cwd`, which is `cwd` itself when there is none.
 *
 * @remarks
 * Discovery wraps a failed read as a `WorkspaceDiscoveryError`. That is the disk's fault rather than the config's, so
 * its `PlatformError` is unwrapped; a workspace file with the wrong content stays a config fault.
 */
export const workspaceRootOf = (
	cwd: string,
): Effect.Effect<string, EffectedConfigError | PlatformError.PlatformError, WorkspaceDiscovery> =>
	WorkspaceDiscovery.use((discovery) => discovery.infoIn(cwd)).pipe(
		Effect.map((info) => info.root),
		Effect.catchTags({
			WorkspaceRootNotFoundError: () => Effect.succeed(cwd),
			WorkspaceDiscoveryError: (error) =>
				Effect.fail(
					error.cause instanceof PlatformErrorModule.PlatformError
						? error.cause
						: new EffectedConfigErrorClass({ path: error.path, reason: error.message }),
				),
			WorkspacePatternError: (error) => Effect.fail(new EffectedConfigErrorClass({ path: cwd, reason: error.message })),
		}),
	);

/** How a build ended, success or crash alike: what it recorded, and where its artifact should be. */
interface BuildOutcome {
	readonly report: BuildReport;
	readonly issuesPath: string;
	readonly crash: Option.Option<{ readonly name: string; readonly message: string }>;
}

const decodeIssues = Schema.decodeUnknownEffect(Schema.fromJsonString(BuildIssuesSchema));

/**
 * The build's `issues.json`, or the same document rebuilt from the report when it cannot stand for this build.
 *
 * @remarks
 * The bundler swallows a failed artifact write, so the file on disk may be a previous build's. One stamped before this
 * build started is therefore never read as its answer, and after a crash neither is a `buildOk: true`. A finished build
 * with no artifact of its own has no gate a reader could trust, so that is a failure too.
 */
const readIssues = Effect.fnUntraced(function* (outcome: BuildOutcome, packageName: string, startedAt: number) {
	const fs = yield* FileSystem.FileSystem;
	const artifact = yield* fs.readFileString(outcome.issuesPath).pipe(Effect.flatMap(decodeIssues), Effect.option);
	// `>=` rather than `<` on the negative, so a stamp that does not parse is not this build's either.
	const fresh = Option.isSome(artifact) && Date.parse(artifact.value.generatedAt) >= startedAt;
	if (fresh && (Option.isNone(outcome.crash) || !artifact.value.buildOk)) {
		return artifact.value;
	}
	const issues = flattenIssues([outcome.report], {
		target: "prod",
		generatedAt: DateTime.formatIso(yield* DateTime.now),
		buildOk: false,
		failure: Option.getOrElse(outcome.crash, () => ({
			name: "BuildRunError",
			message: `the build finished but ${outcome.issuesPath} ${Option.isSome(artifact) ? "is older than this build" : "could not be read"}`,
		})),
	});
	return { ...issues, package: packageName } satisfies BuildIssues;
});

/**
 * Runs one package build.
 *
 * @remarks
 * A build that crashes or records an error is a `failed` verdict rather than a failure, so a front end can always
 * show the report and the journals always get an envelope. The error channel holds a run that could not start or
 * record: no `package.json`, a config or plugin that will not load, a config the bundler rejects before any build
 * work, and a journal that cannot be written.
 *
 * @public
 */
export class BuildRun {
	private constructor() {}

	static readonly run: (
		input: BuildRunInput,
		deps: BuildRunDeps,
	) => Effect.Effect<
		BuildRunResult,
		| EffectedConfigError
		| PluginLoadError
		| NotAPackageError
		| ConfigValidationError
		| AppendError
		| PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("BuildRun.run")(function* (input: BuildRunInput, deps: BuildRunDeps) {
		const pathService = yield* Path.Path;
		const cwd = pathService.resolve(deps.cwd);
		const { onProgress } = deps;

		const packageName = yield* readPackageName(cwd);
		const discovery = WorkspaceDiscovery.layer({ cwd }).pipe(Layer.provide(WorkspaceRoot.layer));
		const root = yield* workspaceRootOf(cwd).pipe(Effect.provide(discovery));
		const resolved = yield* EffectedConfigFile.load({ cwd, root }).pipe(Effect.provide(discovery));
		const { build, tsdoctor } = resolved.config.package;
		const plugins = yield* loadPlugins({
			cwd,
			modules: build.plugins,
			...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
		});
		yield* onProgress?.({ _tag: "Started", package: packageName, config: resolved }) ?? Effect.void;

		const startedAt = DateTime.toEpochMillis(yield* DateTime.now);
		const outcome: BuildOutcome = yield* Bundler.build({
			cwd,
			config: build,
			tsdoctor,
			noExe: input.noExe,
			verbose: input.verbose,
			plugins,
			ci: deps.ci,
			...(deps.seams !== undefined ? { seams: deps.seams } : {}),
		}).pipe(
			Effect.map(
				(result): BuildOutcome => ({
					report: result.report,
					issuesPath: result.issuesPath,
					crash: Option.none(),
				}),
			),
			Effect.catchTag("BundlerError", (error) =>
				Effect.succeed<BuildOutcome>({
					report: error.report,
					issuesPath: pathService.join(cwd, "dist", "prod", "issues.json"),
					crash: Option.some({ name: error.name, message: error.message }),
				}),
			),
		);

		if (onProgress !== undefined) {
			for (const group of outcome.report.targetGroups) {
				for (const pass of group.passes) {
					yield* onProgress({ _tag: "PassDone", pass: pass.id, group: group.id });
				}
			}
		}

		const issues = yield* readIssues(outcome, packageName, startedAt);
		const journals = Layer.mergeAll(BuildJournal.layerAt(root), IssueJournal.layerAt(root)).pipe(
			Layer.provide(deps.journalWatcher ?? NodeJournalWatcher.layer),
		);
		yield* BuildJournal.record(issues, cwd).pipe(Effect.provide(journals));
		yield* onProgress?.({ _tag: "Done", issues }) ?? Effect.void;

		return BuildRunResult.make({
			package: packageName,
			verdict: !issues.buildOk || issues.errors.length > 0 ? "failed" : "ok",
			issues,
			report: outcome.report,
			config: { sources: resolved.sources },
		});
	});
}
