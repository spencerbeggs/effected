// What a consumer's runtime code holds: its identity from its own @effected/schemastore, written into every payload.
import { HostedSchema } from "@effected/schemastore";
import { Schema } from "effect";

export const OutputSchema = HostedSchema.github({
	repo: "effected-fixtures/schema-consumer",
	name: "output",
	versions: ["1.0"],
});

export const Output = Schema.Struct({
	$schema: Schema.Literal(OutputSchema.$id),
	name: Schema.String.annotate({ description: "What produced this output" }),
	count: Schema.optionalKey(Schema.Number),
}).annotate({ description: "One output file of the schema-consumer fixture" });

if (import.meta.main) {
	console.log(JSON.stringify({ $schema: OutputSchema.$id, name: "fixture", count: 1 }));
}
