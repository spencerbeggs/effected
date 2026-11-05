import { CliAudience } from "@effected/cli-kit";
import { Command } from "effect/cli";
import type { SchemaCommandDeps } from "./schema/execute.js";
import { makeSchemaCommand } from "./schema/index.js";

/**
 * The `effected` command tree, closed over the process boundary it runs against: `main` hands in the process values, a
 * test its own. The audience flags are shared on the root so every subcommand accepts them.
 *
 * @public
 */
export const makeRootCommand = (deps: SchemaCommandDeps) =>
	Command.make("effected", {}).pipe(
		Command.withDescription("The effected tool: a toolchain for Effect v4 applications."),
		Command.withSharedFlags(CliAudience.flags()),
		Command.withSubcommands([makeSchemaCommand(deps)]),
	);
