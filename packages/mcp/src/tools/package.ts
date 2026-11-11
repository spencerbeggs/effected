// `package_build`: a thin shell over the engine. What is its own is keeping the directory inside the workspace root,
// serializing the builds, and turning a run that could not start into a refusal an agent can read. A build that crashes
// or records an error is the answer the agent asked for, so it stays an ordinary result.

import type { BuildRunDeps } from "@effected/engine/build";
import { BuildRun, BuildRunResult } from "@effected/engine/build";
import type { Exclusive, ExclusiveTimeout } from "@effected/kit";
import { ToolFailure, ToolRefusal } from "@effected/mcp-kit";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Tool } from "effect/ai";
import { findRoot, inside } from "../root.js";

/**
 * The `package_build` tool: builds one package into its `dist/prod`.
 *
 * @public
 */
export const packageBuild = Tool.make("package_build", {
	description:
		'Builds one package from its effected.toml into dist/prod: JS, declarations, the manifest, the API model and any binary. A build that crashes or records an error arrives as the result\'s verdict "failed" with its issues, not as an error. Reloads the config on every call.',
	parameters: Schema.Struct({
		cwd: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The package directory, resolved against the workspace root and refused outside it. Omitted, the server's working directory.",
			}),
		),
		noExe: Schema.optionalKey(
			Schema.Boolean.annotate({
				description: "Skip the single-executable compile; the manifest still points at the binary.",
			}),
		),
	}),
	success: BuildRunResult,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Build a package")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * What the process boundary gives the package tools, and the test seams.
 *
 * @public
 */
export interface PackageToolOptions {
	/** The server's working directory; omitted, whatever `Path.resolve` takes as current. */
	readonly cwd?: string;
	/** Whether the server runs under CI; omitted, `false`. */
	readonly ci?: boolean;
	/** The plugin module importer; omitted, the engine's `jiti` default. */
	readonly importModule?: BuildRunDeps["importModule"];
	/** Replaces the bundler's side effects, for tests. */
	readonly seams?: BuildRunDeps["seams"];
	/** The journals' watcher; omitted, the engine's default. */
	readonly journalWatcher?: BuildRunDeps["journalWatcher"];
	/** How a build waits for another build of the same package; omitted, the engine's default. */
	readonly lock?: BuildRunDeps["lock"];
	/** Runs a call with its stdout off the wire, because a plugin and the build tools run in this process. */
	readonly confineStdout?: <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

// A lane requires a bound, and a build is the longest thing this server does.
const BUILD_TIMEOUT = "10 minutes";

type BuildFailure = Effect.Error<ReturnType<typeof BuildRun.run>> | ExclusiveTimeout;

/**
 * What an agent can do about a filesystem failure: look at the path, when it names one.
 *
 * @internal
 */
export const platformErrorHint = (error: PlatformError.PlatformError): string => {
	const path = "pathOrDescriptor" in error.reason ? error.reason.pathOrDescriptor : undefined;
	const subject = path !== undefined ? String(path) : "the path the message names";
	return `Check that ${subject} is the right kind of file and can be read and written, then call the tool again.`;
};

const refusalOf = (error: BuildFailure, root: string): ToolRefusal => {
	const refuse = (hint: string): ToolRefusal =>
		ToolRefusal.refuse(ToolFailure.truncate(error.message, ToolFailure.ENGINE_ECHO_LIMIT), { hint });
	switch (error._tag) {
		case "EffectedConfigError":
		case "PluginLoadError":
			return refuse(`Fix ${error.path} and call the tool again; it reloads on every call.`);
		case "ConfigValidationError":
			return refuse(`Fix ${error.path} under [package.build] in effected.toml and call the tool again.`);
		case "NotAPackageError":
			return refuse(`Pass cwd: a package directory under the workspace root ${root}.`);
		case "ExclusiveTimeout":
			return refuse("The build may still be writing dist/prod; wait before calling the tool again.");
		case "BuildLockTimeoutError":
			return refuse(
				`Another build of this package is running; wait for it and call the tool again, or delete ${error.lockPath} if no build is.`,
			);
		case "PlatformError":
			return refuse(platformErrorHint(error));
		default:
			return refuse("Fix what the message names and call the tool again.");
	}
};

/**
 * The handler, closed over the filesystem and path the server was built with, the workspace root found once from
 * `options.cwd`, and the lane it shares with every other build tool.
 *
 * @remarks
 * The lane's timeout cannot stop a build: the bundler's passes are promises nothing can abort, so a timed-out build
 * runs on while the next call holds the permit. The refusal says so.
 *
 * @public
 */
export const makePackageHandlers = (options: PackageToolOptions, lane: Exclusive) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const cwd = path.resolve(options.cwd ?? ".");
		const root = yield* findRoot(cwd);

		return {
			package_build: (params: typeof packageBuild.parametersSchema.Type): Effect.Effect<BuildRunResult, ToolRefusal> =>
				Effect.gen(function* () {
					if (params.cwd !== undefined) yield* inside(root, "cwd", params.cwd);
					return yield* lane.run(
						BuildRun.run(
							{ noExe: params.noExe ?? false, verbose: false },
							{
								cwd: params.cwd !== undefined ? path.resolve(root, params.cwd) : cwd,
								ci: options.ci ?? false,
								...(options.importModule !== undefined ? { importModule: options.importModule } : {}),
								...(options.seams !== undefined ? { seams: options.seams } : {}),
								...(options.journalWatcher !== undefined ? { journalWatcher: options.journalWatcher } : {}),
								...(options.lock !== undefined ? { lock: options.lock } : {}),
							},
						),
						{ timeout: BUILD_TIMEOUT },
					);
				}).pipe(
					Effect.catch((error: BuildFailure | ToolRefusal) =>
						error._tag === "ToolRefusal"
							? Effect.fail(error)
							: Effect.gen(function* () {
									yield* Effect.logDebug("package tool refused", { error: error.message });
									return yield* Effect.fail(refusalOf(error, root));
								}),
					),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
					options.confineStdout ?? ((self) => self),
				),
		};
	});
