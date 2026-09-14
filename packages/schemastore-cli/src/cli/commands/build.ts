import { Command } from "effect/unstable/cli";
import type { ExecuteDeps } from "../execute.js";
import { execute } from "../execute.js";
import { commandFlags } from "../flags.js";

/**
 * `schemastore build`: generate, gate and write every schema and catalog
 * entry the config declares.
 *
 * @public
 */
export const makeBuildCommand = (deps: ExecuteDeps) =>
	Command.make("build", commandFlags, (input) => execute("build", input, deps)).pipe(
		Command.withDescription("Generate, gate and write every schema and catalog entry the config declares"),
	);
