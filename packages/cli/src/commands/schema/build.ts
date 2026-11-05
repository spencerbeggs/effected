import { Command } from "effect/cli";
import type { SchemaCommandDeps } from "./execute.js";
import { execute } from "./execute.js";
import { commandFlags } from "./flags.js";

/** `effected schema build`: generate, gate and write every schema and catalog entry the config declares. */
export const makeBuildCommand = (deps: SchemaCommandDeps) =>
	Command.make("build", commandFlags, (input) => execute("build", input, deps)).pipe(
		Command.withDescription(
			"Generate, gate and write every schema the config declares, its catalog slice, and the merged catalog",
		),
	);
