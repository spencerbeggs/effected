import { Command } from "effect/unstable/cli";

export const rootCommand = Command.make("schemastore", {}).pipe(
	Command.withDescription("Build helper for schemastore"),
	//Command.withSubcommands([validateCommand, initCommand, contextCommand, verifyCommand, syncCommand]),
);
