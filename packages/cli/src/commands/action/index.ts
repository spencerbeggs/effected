import { Command } from "effect/cli";
import { makeBuildCommand } from "./build.js";
import type { ActionCommandDeps } from "./execute.js";

/** `effected action`: the group, closed over the process boundary it runs against. */
export const makeActionCommand = (deps: ActionCommandDeps) =>
	Command.make("action", {}).pipe(
		Command.withDescription("Build the GitHub Action in the working directory from its effected.toml"),
		Command.withSubcommands([makeBuildCommand(deps)]),
	);
