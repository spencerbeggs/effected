import { Command } from "effect/cli";
import { makeBuildCommand } from "./build.js";
import type { ActionCommandDeps } from "./execute.js";
import { makeInitCommand } from "./init.js";

/** `effected action`: the group, closed over the process boundary it runs against. */
export const makeActionCommand = (deps: ActionCommandDeps) =>
	Command.make("action", {}).pipe(
		Command.withDescription("Scaffold or build the GitHub Action in the working directory, from its effected.toml"),
		Command.withSubcommands([makeBuildCommand(deps), makeInitCommand(deps)]),
	);
