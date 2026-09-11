import { Argument, Command, Flag } from "effect/unstable/cli";

const path = Argument.string("path").pipe(Argument.withDescription("path to the schema file"));

const drift = Flag.choice("format", ["human", "json"]).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

export const buildCommand = Command.make("build", {
	drift,
	path,
}).pipe(Command.withDescription("Generate SchemaStore artifacts"));
