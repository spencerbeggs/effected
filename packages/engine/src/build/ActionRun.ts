// The shared body of `effected action build` and the MCP's `action_build`: load the config, run the action builder, and
// answer with a verdict. Exit codes and rendering stay with the front ends.

import type {
	ActionBuilderError,
	ActionYmlPathError,
	BundleFailed,
	CleanError,
	EffectedConfigError,
	PersistLocalError,
	WriteError,
} from "@effected/bundler";
import { ActionBuildResult, ActionBuilder, BuildResult, EffectedConfigFile } from "@effected/bundler";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import type { FileSystem, PlatformError } from "effect";
import { Effect, Layer, Path, Schema } from "effect";
import { ActionRunResult } from "./ActionRunResult.js";
import type { BuildRunDeps, NotAPackageError } from "./BuildRun.js";
import { readPackageName, workspaceRootOf } from "./BuildRun.js";

/**
 * The directory asked to build as an action has no `[action]` table in its config, so it is a library.
 *
 * @public
 */
export class NotAnActionError extends Schema.TaggedError<NotAnActionError>()("NotAnActionError", {
	/** The directory. */
	cwd: Schema.String,
}) {
	override get message(): string {
		return `${this.cwd} is not an action: its effected.toml has no [action] table`;
	}
}

/**
 * What one action build was asked to do, as the flags or tool parameters said it.
 *
 * @public
 */
export interface ActionRunInput {
	/** Whether to validate before bundling and check bundle sizes after it. */
	readonly validate: boolean;
	/** Whether to copy the build locally. `persistLocal.enabled = false` turns that off too. */
	readonly persist: boolean;
}

/**
 * What the process boundary supplies for an action build: the parts of {@link BuildRunDeps} it uses.
 *
 * @public
 */
export type ActionRunDeps = Pick<BuildRunDeps, "cwd" | "ci">;

/** The partial result a builder failure stops with. No bundling happened when `build` is absent. */
const failedResult = (error: Extract<ActionBuilderError, { readonly _tag: "ValidationFailed" | "BuildFailed" }>) =>
	ActionRunResult.make({
		verdict: "failed",
		result: ActionBuildResult.make({
			validation: error.validation,
			build: error.build ?? BuildResult.make({ success: false, entries: [], duration: 0 }),
			persisted: false,
		}),
	});

/**
 * Runs one GitHub Action build.
 *
 * @remarks
 * Validation stopping the build and an entry failing to bundle or load are a `failed` verdict rather than a failure,
 * with what happened so far in the result, so a front end can always render it. The error channel holds a run that could
 * not start or finish: no `package.json`, a config that will not load, no `[action]` table, an entry that is missing
 * with validation off, and a file that cannot be cleaned, written or persisted.
 *
 * It appends to no journal: the build and issue journals record package builds only.
 *
 * @public
 */
export class ActionRun {
	private constructor() {}

	static readonly run: (
		input: ActionRunInput,
		deps: ActionRunDeps,
	) => Effect.Effect<
		ActionRunResult,
		| EffectedConfigError
		| NotAPackageError
		| NotAnActionError
		| BundleFailed
		| CleanError
		| WriteError
		| PersistLocalError
		| ActionYmlPathError
		| PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("ActionRun.run")(function* (input: ActionRunInput, deps: ActionRunDeps) {
		const pathService = yield* Path.Path;
		const cwd = pathService.resolve(deps.cwd);

		yield* readPackageName(cwd);
		const discovery = WorkspaceDiscovery.layer({ cwd }).pipe(Layer.provide(WorkspaceRoot.layer));
		const root = yield* workspaceRootOf(cwd).pipe(Effect.provide(discovery));
		const { config } = yield* EffectedConfigFile.load({ cwd, root }).pipe(Effect.provide(discovery));
		if (config.action === undefined) return yield* new NotAnActionError({ cwd });

		return yield* ActionBuilder.build({
			cwd,
			config: config.action,
			validate: input.validate,
			persist: input.persist,
			ci: deps.ci,
		}).pipe(
			Effect.map((result) => ActionRunResult.make({ verdict: "ok", result })),
			Effect.catchTags({
				ValidationFailed: (error) => Effect.succeed(failedResult(error)),
				BuildFailed: (error) => Effect.succeed(failedResult(error)),
			}),
		);
	});
}
