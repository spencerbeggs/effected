import { Command } from "effect/cli";
import { makeBuildCommand } from "./build.js";
import type { PackageCommandDeps } from "./execute.js";

/** `effected package`: the group, closed over the process boundary it runs against. */
export const makePackageCommand = (deps: PackageCommandDeps) =>
	Command.make("package", {}).pipe(
		Command.withDescription("Build the package in the working directory from its effected.toml"),
		Command.withSubcommands([makeBuildCommand(deps)]),
	);
