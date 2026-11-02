import { CliAudience } from "@effected/cli-kit";
import { Command } from "effect/cli";

/**
 * The `effected` command tree. This release carries no subcommand: `--version`
 * and `--help` come from the framework, and the audience flags are shared on
 * the root so every future subcommand accepts them.
 *
 * @public
 */
export const rootCommand = Command.make("effected", {}).pipe(
	Command.withDescription("The effected tool: a toolchain for Effect v4 applications."),
	Command.withSharedFlags(CliAudience.flags()),
);
