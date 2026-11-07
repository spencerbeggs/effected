import { CliAudience } from "@effected/cli-kit";
import { Command } from "effect/cli";
import type { ActionCommandDeps } from "./action/execute.js";
import { makeActionCommand } from "./action/index.js";
import type { PackageCommandDeps } from "./package/execute.js";
import { makePackageCommand } from "./package/index.js";
import type { SchemaCommandDeps } from "./schema/execute.js";
import { makeSchemaCommand } from "./schema/index.js";

/**
 * What every command is given by the process boundary, and the test seams.
 *
 * @public
 */
export type CommandDeps = SchemaCommandDeps & PackageCommandDeps & ActionCommandDeps;

/**
 * The `effected` command tree, closed over the process boundary it runs against: `main` hands in the process values, a
 * test its own. The audience flags are shared on the root so every subcommand accepts them.
 *
 * @public
 */
export const makeRootCommand = (deps: CommandDeps) =>
	Command.make("effected", {}).pipe(
		Command.withDescription("The effected tool: a toolchain for Effect v4 applications."),
		Command.withSharedFlags(CliAudience.flags()),
		Command.withSubcommands([makeSchemaCommand(deps), makePackageCommand(deps), makeActionCommand(deps)]),
	);
