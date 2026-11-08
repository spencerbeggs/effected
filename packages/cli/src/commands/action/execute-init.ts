// The body of `action init`: ask the engine, report what it wrote and what to add, and map a refusal onto the exit-code
// contract. Process globals arrive through `ActionCommandDeps`, so nothing here reads them.

import { CliRuntime, Doc } from "@effected/cli-kit";
import { Console, Effect, Option, Schema } from "effect";
import { InitDoc } from "../../render/InitDoc.js";
import { resolveFormat } from "../schema/execute.js";
import { ActionInitError, ActionRunError } from "./errors.js";
import type { ActionCommandDeps } from "./execute.js";

/** The parsed flags of `action init`. */
export interface InitInput {
	readonly format: Option.Option<"human" | "json">;
	readonly name: Option.Option<string>;
	readonly description: Option.Option<string>;
	readonly force: boolean;
}

/**
 * Run one `action init`.
 *
 * @remarks
 * The engine's build entry is imported here, as `action build` imports it, so `effected --version` never loads it.
 */
export const executeInit = Effect.fn("effected.action.init")(function* (input: InitInput, deps: ActionCommandDeps) {
	const format = yield* resolveFormat(input.format);
	const { ActionInit, ActionInitResult } = yield* Effect.promise(() => import("@effected/engine/build"));

	const refused = (error: { readonly message: string }) =>
		Effect.fail(CliRuntime.reported(new ActionInitError({ message: error.message }), 2));
	const stopped = (error: { readonly message: string }) =>
		Effect.fail(CliRuntime.reported(new ActionRunError({ message: error.message }), 3));
	const answer = yield* ActionInit.run(
		{
			...Option.match(input.name, { onNone: () => ({}), onSome: (name) => ({ name }) }),
			...Option.match(input.description, { onNone: () => ({}), onSome: (description) => ({ description }) }),
			force: input.force,
		},
		{ cwd: deps.cwd },
	).pipe(
		Effect.catchTags({
			NotAPackageError: refused,
			ActionMetadataMissingError: refused,
			ActionMetadataInvalidError: refused,
			// A symbolic link, a wrong-kind entry or an escaping path: `--force` never overrides these.
			ScaffoldConflictError: refused,
			ScaffoldExistsError: (error) =>
				Effect.fail(
					CliRuntime.reported(new ActionInitError({ message: `${error.message}: pass --force to replace them` }), 2),
				),
			ScaffoldWriteError: stopped,
			PlatformError: stopped,
		}),
	);

	if (format === "json") {
		yield* Console.log(JSON.stringify(Schema.encodeSync(ActionInitResult)(answer)));
		for (const line of InitDoc.lines(answer)) yield* Effect.logInfo(line);
	} else {
		yield* Doc.print([InitDoc.render(answer)]);
	}
});
