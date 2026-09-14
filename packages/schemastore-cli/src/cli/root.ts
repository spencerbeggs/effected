import { Command } from "effect/unstable/cli";

export const rootCommand = Command.make("schemastore", {}).pipe(
	Command.withDescription("Build and check SchemaStore-shaped JSON Schema documents from a schemastore.config.ts"),
);
