import { Command } from "effect/cli";
import type { ActionCommandDeps } from "./execute.js";
import { execute } from "./execute.js";
import { buildFlags } from "./flags.js";

/** `effected action build`: build the GitHub Action in the working directory into its `dist`. */
export const makeBuildCommand = (deps: ActionCommandDeps) =>
	Command.make("build", buildFlags, (input) => execute(input, deps)).pipe(
		Command.withDescription(
			"Build the GitHub Action in the working directory from the [action] table of its effected.toml into dist",
		),
	);
