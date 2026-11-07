// The body of `action build`: ask the engine, report, and turn the verdict into the exit-code contract. Process globals
// arrive through `ActionCommandDeps`, so nothing here reads them.

import { CliRuntime, Doc } from "@effected/cli-kit";
import type { ActionRunDeps } from "@effected/engine/build";
import { StepSummary } from "@effected/engine/schema";
import type { Option } from "effect";
import { Console, Effect, Schema } from "effect";
import { ActionDoc } from "../../render/ActionDoc.js";
import { resolveFormat } from "../schema/execute.js";
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
}

/**
 * Run one `action build`.
 *
 * @remarks
 * The engine's build entry is imported here rather than at the top of the module: it loads the bundler and its
 * toolchain, which `effected --version` and every `effected schema` run have no use for. The report is emitted first and
 * the failure follows, so a run that fails has still said why.
 */
export const execute = Effect.fn("effected.action.execute")(function* (input: ExecuteInput, deps: ActionCommandDeps) {
	const format = yield* resolveFormat(input.format);
	const { ActionRun, ActionRunResult } = yield* Effect.promise(() => import("@effected/engine/build"));

	const refused = (error: { readonly message: string }) =>
		Effect.fail(CliRuntime.reported(new ActionConfigError({ message: error.message }), 2));
	const stopped = (error: { readonly message: string }) =>
		Effect.fail(CliRuntime.reported(new ActionRunError({ message: error.message }), 3));
	const answer = yield* ActionRun.run({ validate: !input.noValidate, persist: !input.noPersist }, deps).pipe(
		Effect.catchTags({
			EffectedConfigError: refused,
			NotAPackageError: refused,
			NotAnActionError: refused,
			BundleFailed: stopped,
			CleanError: stopped,
			WriteError: stopped,
			PersistLocalError: stopped,
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
	yield* StepSummary.append(ActionDoc.markdown(answer.result));

	if (answer.verdict === "failed") {
		return yield* Effect.fail(
			CliRuntime.reported(
				new ActionBuildFailedError({
					errors: answer.result.validation.errors.length,
					failedEntries: answer.result.build.entries.filter((entry) => !entry.success).length,
				}),
				1,
			),
		);
	}
});
