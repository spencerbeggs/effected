import { Command } from "effect/cli";
import { makeBuildCommand } from "./build.js";
import { makeCheckCommand } from "./check.js";
import type { SchemaCommandDeps } from "./execute.js";
import { makeValidateCommand } from "./validate.js";

/** `effected schema`: the group, closed over the process boundary it runs against. */
export const makeSchemaCommand = (deps: SchemaCommandDeps) =>
	Command.make("schema", {}).pipe(
		Command.withDescription(
			"Build and check SchemaStore-shaped JSON Schema documents from a schemastore.config.ts, and validate payloads against them",
		),
		Command.withSubcommands([makeBuildCommand(deps), makeCheckCommand(deps), makeValidateCommand(deps)]),
	);
