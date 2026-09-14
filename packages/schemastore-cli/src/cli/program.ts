// The runnable program short of the runtime: argument parsing, the command
// tree over injected process values, and the exit-code mapping. `main.ts`
// adds `NodeServices`, `reportFailures` and `runMain`; tests provide a test
// `Command.Environment` and assert on the failure's exit-code marker.

import { CliLogger, CliRuntime } from "@effected/cli";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { ConfigLoadError } from "../ConfigLoader.js";
import type { ExecuteDeps } from "./execute.js";
import { makeCommands } from "./root.js";

/**
 * {@link ExecuteDeps} plus the version `--version` prints.
 *
 * @public
 */
export interface ProgramDeps extends ExecuteDeps {
	readonly version: string;
}

/**
 * The logger the program writes through: stdout is `Console.log` only,
 * so EVERY log level is routed to stderr — warnings, the human lines under
 * `--format=json`, and the rendered failure.
 *
 * @public
 */
export const loggerLayer = CliLogger.layer({ stderrFrom: "All" });

// A load failure's `reason` may carry a whole stack. The first line is the
// message a person reads; the rest is kept at debug for `--log-level debug`.
const trimLoadError = Effect.fn("schemastore.trimLoadError")(function* (error: ConfigLoadError) {
	const [first = "", ...rest] = error.reason.split("\n");
	if (rest.length > 0) {
		yield* Effect.logDebug(rest.join("\n"));
	}
	return new ConfigLoadError({ path: error.path, reason: first });
});

/**
 * Parse `args` and run the selected command.
 *
 * @remarks
 * Fails with the marked error the runtime maps to the exit code:
 * `ShowHelp` is `64` with parse errors and `0` without (help itself was
 * already rendered); `ConfigNotFoundError` / `ConfigLoadError` are `2`;
 * `DriftError` / `GateError` arrive already marked `1`.
 *
 * @public
 */
export const program = (args: ReadonlyArray<string>, deps: ProgramDeps) =>
	Command.runWith(makeCommands(deps).root, { version: deps.version })(args).pipe(
		Effect.catchTags({
			ShowHelp: (help) => Effect.fail(CliRuntime.reported(help, help.errors.length > 0 ? 64 : 0) as typeof help),
			ConfigNotFoundError: (error) => Effect.fail(CliRuntime.reported(error, 2) as typeof error),
			ConfigLoadError: (error) =>
				trimLoadError(error).pipe(
					Effect.flatMap((trimmed) => Effect.fail(CliRuntime.reported(trimmed, 2) as typeof trimmed)),
				),
		}),
	);
