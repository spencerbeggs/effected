import { Command } from "effect/cli";
import type { PackageCommandDeps } from "./execute.js";
import { execute } from "./execute.js";
import { buildFlags } from "./flags.js";

/** `effected package build`: build the package in the working directory into its `dist/prod`. */
export const makeBuildCommand = (deps: PackageCommandDeps) =>
	Command.make("build", buildFlags, (input) => execute(input, deps)).pipe(
		Command.withDescription(
			"Build the package in the working directory into dist/prod: JS, declarations, the manifest, the API model and any binary",
		),
	);
