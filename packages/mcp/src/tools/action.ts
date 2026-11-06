// `action_build`: a thin shell over the engine. What is its own is keeping the directory inside the workspace root,
// sharing the build lane, and turning a run that could not start or finish into a refusal an agent can read. Validation
// stopping the build or an entry failing is the answer the agent asked for, so it stays an ordinary result.

import { ActionRun, ActionRunResult } from "@effected/engine/build";
import type { Exclusive, ExclusiveTimeout } from "@effected/kit";
import { ToolFailure, ToolRefusal } from "@effected/mcp-kit";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Tool } from "effect/ai";
import { findRoot, inside } from "../root.js";
import type { PackageToolOptions } from "./package.js";

/**
 * The `action_build` tool: builds one GitHub Action into its `dist`.
 *
 * @public
 */
export const actionBuild = Tool.make("action_build", {
	description:
		'Builds one GitHub Action from the [action] table of its effected.toml into dist: validates the config and action.yml, bundles each entry into one file, checks that each loads, and copies the build to the local action directory. Validation stopping the build or an entry failing arrives as the result\'s verdict "failed", not as an error. Reloads the config on every call. The load check imports each bundle, which runs an action with no GITHUB_ACTIONS guard unless [action.build] importCheck is false.',
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
				description: "Copy the build to the local action directory, unless the config disables it. Omitted, true.",
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
		default:
			return refuse("Fix what the message names and call the tool again.");
	}
};

/**
 * The handler, closed over the filesystem and path the server was built with, the workspace root found once from
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

		return {
			action_build: (params: typeof actionBuild.parametersSchema.Type): Effect.Effect<ActionRunResult, ToolRefusal> =>
				Effect.gen(function* () {
					if (params.cwd !== undefined) yield* inside(root, "cwd", params.cwd);
					return yield* lane.run(
						ActionRun.run(
							{ validate: params.validate ?? true, persist: params.persist ?? true },
							{
								cwd: params.cwd !== undefined ? path.resolve(root, params.cwd) : cwd,
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
