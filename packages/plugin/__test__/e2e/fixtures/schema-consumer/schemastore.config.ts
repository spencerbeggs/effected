import { defineSchemastore } from "@effected/plugin";
import { Output, OutputSchema } from "./src/output.ts";

export default defineSchemastore({
	name: "schema-consumer",
	outputDir: "expected",
	schemas: {
		[OutputSchema.name]: {
			schema: Output,
			hosted: OutputSchema,
			catalog: { description: "schema-consumer fixture output", fileMatch: ["output.json"] },
		},
	},
});
