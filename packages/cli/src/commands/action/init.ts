import { Command } from "effect/cli";
import type { ActionCommandDeps } from "./execute.js";
import { executeInit } from "./execute-init.js";
import { initFlags } from "./flags.js";

/** `effected action init`: scaffold a new GitHub Action in the working directory. */
export const makeInitCommand = (deps: ActionCommandDeps) =>
	Command.make("init", initFlags, (input) => executeInit(input, deps)).pipe(
		Command.withDescription(
			"Scaffold a new GitHub Action in the working directory: the [action] table of effected.toml, action.yml, src/main.ts, src/program.ts and tsconfig.json",
		),
	);
