import { Command } from "effect/unstable/cli";
import type { ExecuteDeps } from "../execute.js";
import { execute } from "../execute.js";
import { commandFlags } from "../flags.js";

/**
 * `schemastore check`: the same walk as `build`, reported and never written.
 *
 * @public
 */
export const makeCheckCommand = (deps: ExecuteDeps) =>
	Command.make("check", commandFlags, (input) => execute("check", input, deps)).pipe(
		Command.withDescription("Report what build would do, exit non-zero under the same conditions, and write nothing"),
	);
