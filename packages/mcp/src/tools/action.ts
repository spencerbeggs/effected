// `action_build` and `action_init`: thin shells over the engine. What is theirs is keeping the directory inside the
// workspace root, sharing the build lane (`action_build` only), and turning a run that could not start or finish into a
// refusal an agent can read. Validation stopping the build or an entry failing is the answer asked for: a result.

import { ActionInit, ActionInitResult, ActionRun, ActionRunResult } from "@effected/engine/build";
import type { Exclusive, ExclusiveTimeout } from "@effected/kit";
import { ToolFailure, ToolRefusal } from "@effected/mcp-kit";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Tool } from "effect/ai";
import { findRoot, inside } from "../root.js";
import type { PackageToolOptions } from "./package.js";
import { platformErrorHint } from "./package.js";

/**
 * The `action_build` tool: builds one GitHub Action into its `dist`.
 *
 * @public
 */
export const actionBuild = Tool.make("action_build", {
	description:
		"Builds one GitHub Action from the [action] table of its effected.toml into dist: validates the config and action.yml, bundles each entry into one file, and checks that each loads. It writes only dist unless persist is true, which also copies the build to .github/actions/local and generates .actrc and .github/workflows/act-test.yml. Validation stopping the build or an entry failing arrives as the result's verdict \"failed\", not as an error. Reloads the config on every call. The load check imports each bundle, which runs an action with no GITHUB_ACTIONS guard unless [action.build] importCheck is false; a worker's own table can set importCheck = false to skip that worker alone.",
	parameters: Schema.Struct({
		cwd: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The action's directory, resolved against the workspace root and refused outside it. Omitted, the server's working directory.",
			}),
		),
		validate: Schema.optionalKey(
			Schema.Boolean.annotate({
				description: "Validate first and check bundle sizes after. Omitted, true.",
			}),
		),
		persist: Schema.optionalKey(
			Schema.Boolean.annotate({
				description:
					"Copy the build to .github/actions/local and generate .actrc and .github/workflows/act-test.yml when they are absent, unless the config disables it. Omitted, false.",
			}),
		),
	}),
	success: ActionRunResult,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Build a GitHub Action")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * The `action_init` tool: scaffolds a new GitHub Action.
 *
 * @public
 */
export const actionInit = Tool.make("action_init", {
	description:
		"Scaffolds a new GitHub Action in a package directory: the [action] table of effected.toml, action.yml, src/main.ts, src/program.ts and tsconfig.json, to the kit's canonical shape, ready for action_build. It refuses, writing nothing, when any of those files exists, unless force is true, and always when a path it writes is a symbolic link or the wrong kind of entry: it never follows a link and never writes outside cwd. It edits no package.json: the result names the dependencies to add and whether the package is type module.",
	parameters: Schema.Struct({
		cwd: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The package directory, resolved against the workspace root and refused outside it. Omitted, the server's working directory.",
			}),
		),
		name: Schema.optionalKey(
			Schema.String.annotate({
				description: "The action's display name in action.yml. Omitted, package.json's name without its scope.",
			}),
		),
		description: Schema.optionalKey(
			Schema.String.annotate({
				description: "What the action does, for action.yml. Omitted, package.json's description.",
			}),
		),
		force: Schema.optionalKey(
			Schema.Boolean.annotate({ description: "Replace files that already exist. Omitted, false." }),
		),
	}),
	success: ActionInitResult,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Scaffold a GitHub Action")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Idempotent, false)
	.annotate(Tool.OpenWorld, false);

type InitFailure = Effect.Error<ReturnType<typeof ActionInit.run>>;

const initRefusalOf = (error: InitFailure, root: string): ToolRefusal => {
	const refuse = (hint: string): ToolRefusal =>
		ToolRefusal.refuse(ToolFailure.truncate(error.message, ToolFailure.ENGINE_ECHO_LIMIT), { hint });
	switch (error._tag) {
		case "NotAPackageError":
			return refuse(`Pass cwd: a package directory under the workspace root ${root}, with a package.json.`);
		case "ActionMetadataMissingError":
			return refuse(`Pass ${error.field}, or set "${error.field}" in package.json.`);
		case "ActionMetadataInvalidError":
			return refuse(`Pass a ${error.field} on one line, without control characters.`);
		case "ScaffoldConflictError":
			return refuse(
				"Remove or rename those paths: force never replaces a symbolic link or an entry of the wrong kind, and never writes outside cwd.",
			);
		case "ScaffoldWriteError":
			return refuse(`Check that ${error.cwd} can be written; the files already written are named above.`);
		case "ScaffoldExistsError":
			return refuse("Pass force: true to replace them, or remove them first.");
		case "PlatformError":
			return refuse(platformErrorHint(error));
	}
};

// A lane requires a bound, and a build is the longest thing this server does.
const BUILD_TIMEOUT = "10 minutes";

type ActionFailure = Effect.Error<ReturnType<typeof ActionRun.run>> | ExclusiveTimeout;

const refusalOf = (error: ActionFailure, root: string): ToolRefusal => {
	const refuse = (hint: string): ToolRefusal =>
		ToolRefusal.refuse(ToolFailure.truncate(error.message, ToolFailure.ENGINE_ECHO_LIMIT), { hint });
	switch (error._tag) {
		case "EffectedConfigError":
			return refuse(`Fix ${error.path} and call the tool again; it reloads on every call.`);
		case "NotAPackageError":
			return refuse(`Pass cwd: an action directory under the workspace root ${root}.`);
		case "NotAnActionError":
			return refuse(`Add an [action] table to ${error.cwd}/effected.toml, or pass cwd: an action directory.`);
		case "BundleFailed":
			return refuse(`Fix ${error.entry} under [action.entries] in effected.toml and call the tool again.`);
		case "CleanError":
			return refuse(`Check that ${error.directory} can be removed and call the tool again.`);
		case "WriteError":
			return refuse(`Check that ${error.path} can be written and call the tool again.`);
		case "PersistLocalError":
			return refuse(`Check that ${error.path} can be copied, or pass persist: false.`);
		case "ActionYmlPathError":
			return refuse(`Point runs.${error.entryType} in action.yml at a built file, or pass persist: false.`);
		case "ExclusiveTimeout":
			return refuse("The build may still be writing dist; wait before calling the tool again.");
		case "PlatformError":
			return refuse(platformErrorHint(error));
	}
};

/**
 * The handlers, closed over the filesystem and path the server was built with, the workspace root found once from
 * `options.cwd`, and the lane it shares with every other build tool.
 *
 * @public
 */
export const makeActionHandlers = (options: PackageToolOptions, lane: Exclusive) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const cwd = path.resolve(options.cwd ?? ".");
		const root = yield* findRoot(cwd);

		const target = (requested: string | undefined) => (requested !== undefined ? path.resolve(root, requested) : cwd);

		return {
			// No lane: it writes sources a build reads, never dist, and it is done in milliseconds.
			action_init: (params: typeof actionInit.parametersSchema.Type): Effect.Effect<ActionInitResult, ToolRefusal> =>
				Effect.gen(function* () {
					if (params.cwd !== undefined) yield* inside(root, "cwd", params.cwd);
					return yield* ActionInit.run(
						{
							...(params.name !== undefined ? { name: params.name } : {}),
							...(params.description !== undefined ? { description: params.description } : {}),
							force: params.force ?? false,
						},
						{ cwd: target(params.cwd) },
					).pipe(Effect.mapError((error) => initRefusalOf(error, root)));
				}).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path)),
			action_build: (params: typeof actionBuild.parametersSchema.Type): Effect.Effect<ActionRunResult, ToolRefusal> =>
				Effect.gen(function* () {
					if (params.cwd !== undefined) yield* inside(root, "cwd", params.cwd);
					return yield* lane.run(
						ActionRun.run(
							{ validate: params.validate ?? true, persist: params.persist ?? false },
							{
								cwd: target(params.cwd),
								ci: options.ci ?? false,
							},
						),
						{ timeout: BUILD_TIMEOUT },
					);
				}).pipe(
					Effect.catch((error: ActionFailure | ToolRefusal) =>
						error._tag === "ToolRefusal"
							? Effect.fail(error)
							: Effect.gen(function* () {
									yield* Effect.logDebug("action tool refused", { error: error.message });
									return yield* Effect.fail(refusalOf(error, root));
								}),
					),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path),
					options.confineStdout ?? ((self) => self),
				),
		};
	});
