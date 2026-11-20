// The body of `action build`: ask the engine, report, and turn the verdict into the exit-code contract. Process globals
// arrive through `ActionCommandDeps`, so nothing here reads them.

import { CliRuntime, Doc } from "@effected/cli-kit";
import type { ActionRunDeps } from "@effected/engine/build";
import { StepSummary } from "@effected/engine/schema";
import type { Option } from "effect";
import { Console, Effect, Schema } from "effect";
import { ActionDoc } from "../../render/ActionDoc.js";
import { resolveFormat } from "../schema/execute.js";
import { refuseUnderCi, reportAndContinue, triggerLine } from "../watch.js";
import { ActionBuildFailedError, ActionConfigError, ActionRunError } from "./errors.js";

/**
 * What `effected action` is given by the process boundary. `main` reads `cwd` and `ci`, and nothing else reads the
 * process.
 *
 * @public
 */
export type ActionCommandDeps = ActionRunDeps;

/** The parsed flags of `action build`. */
export interface ExecuteInput {
	readonly format: Option.Option<"human" | "json">;
	readonly noValidate: boolean;
	readonly noPersist: boolean;
	readonly check: boolean;
	readonly watch: boolean;
}

const refused = (error: { readonly message: string }) =>
	Effect.fail(CliRuntime.reported(new ActionConfigError({ message: error.message }), 2));
// A flag combination the command cannot honour: a usage error, exit 64, before any build.
const usage = (message: string) => Effect.fail(CliRuntime.reported(new ActionConfigError({ message }), 64));
const stopped = (error: { readonly message: string }) =>
	Effect.fail(CliRuntime.reported(new ActionRunError({ message: error.message }), 3));

/**
 * Run one build and report it.
 *
 * @remarks
 * The report is emitted first and the failure follows, so a run that fails has still said why. Under `--watch` the step
 * summary is not written: CI refuses `--watch`.
 */
const runOnce = Effect.fn("effected.action.runOnce")(function* (
	input: ExecuteInput,
	deps: ActionCommandDeps,
	format: "human" | "json",
) {
	const { ActionRun, ActionRunResult } = yield* Effect.promise(() => import("@effected/engine/build"));
	const answer = yield* ActionRun.run(
		{ validate: !input.noValidate, persist: input.check || !input.noPersist, check: input.check },
		deps,
	).pipe(
		Effect.catchTags({
			EffectedConfigError: refused,
			NotAPackageError: refused,
			NotAnActionError: refused,
			BundleFailed: stopped,
			CleanError: stopped,
			WriteError: stopped,
			PersistLocalError: stopped,
			// A persist path that cannot be used is a config that will not load.
			PersistPathError: refused,
			CheckUnavailable: (error) => usage(error.message),
			NoOutput: (error) => usage(`${error.message}: drop --no-persist, or keep dist`),
			ActionYmlPathError: stopped,
			PlatformError: stopped,
		}),
	);

	if (format === "json") {
		yield* Console.log(JSON.stringify(Schema.encodeSync(ActionRunResult)(answer)));
		for (const line of ActionDoc.lines(answer.result)) yield* Effect.logInfo(line);
	} else {
		yield* Doc.print([ActionDoc.render(answer.result)]);
	}
	// Here and not in the engine: an `action_build` over MCP inside an Actions step must not write the summary.
	if (!input.watch) yield* StepSummary.append(ActionDoc.markdown(answer.result));

	if (answer.verdict === "failed") {
		return yield* Effect.fail(
			CliRuntime.reported(
				new ActionBuildFailedError({
					errors: answer.result.validation.errors.length,
					failedEntries: answer.result.build.entries.filter((entry) => !entry.success).length,
					drift: answer.result.drift?.length ?? 0,
				}),
				1,
			),
		);
	}
});

/**
 * Run one `action build`, or under `--watch` one per change until interrupted.
 *
 * @remarks
 * The engine's build entry is imported here rather than at the top of the module: it loads the bundler and its
 * toolchain, which `effected --version` and every `effected schema` run have no use for.
 *
 * Under `--watch`, no `package.json`, no `[action]` table or a workspace root that cannot be discovered exits `2` before
 * any watch exists. After that a run's failure is rendered on stderr and the watch goes on, its exclusions re-read from
 * the config before each batch; only a watcher failure ends it, with exit `3`.
 */
export const execute = Effect.fn("effected.action.execute")(function* (input: ExecuteInput, deps: ActionCommandDeps) {
	const format = yield* resolveFormat(input.format);
	if (input.check && input.watch) return yield* usage("--check compares one build and cannot be combined with --watch");
	if (input.check && input.noPersist) {
		return yield* usage("--check compares against the persisted build and cannot be combined with --no-persist");
	}
	if (!input.watch) return yield* runOnce(input, deps, format);

	yield* refuseUnderCi;
	const { BuildWatch } = yield* Effect.promise(() => import("@effected/engine/build"));
	const target = yield* BuildWatch.target(deps.cwd, "action").pipe(
		Effect.catchTags({
			NotAPackageError: refused,
			NotAnActionError: refused,
			EffectedConfigError: refused,
			PlatformError: stopped,
		}),
	);
	return yield* BuildWatch.run({
		...target,
		exclude: BuildWatch.actionExcludes(target, { persist: !input.noPersist }),
		build: (trigger) =>
			Effect.gen(function* () {
				const line = triggerLine(trigger);
				if (line !== undefined) yield* Console.error(line);
				yield* reportAndContinue(runOnce(input, { ...deps, cwd: target.cwd }, format));
			}),
	}).pipe(Effect.catchTag("PlatformError", stopped));
});
