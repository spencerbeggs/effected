// What a consumer's runtime code holds: its identity from its own @effected/schemastore, written into every payload.
import { HostedSchema } from "@effected/schemastore";
import { Effect, Schema } from "effect";

export const OutputSchema = HostedSchema.github({
	repo: "effected-fixtures/schema-consumer",
	name: "output",
	versions: ["1.0"],
});

// One identified schema reused at several annotated sites, one level down and at the root, through a decoding
// default: core recognises those copies as one definition only with the copy of effect that built them, so a
// carrier lowering them with its own copy wrote Scope, Scope_1, Scope_2 (effected#1348).
const Scope = Schema.Union([Schema.Boolean, Schema.Struct({ preserve: Schema.Array(Schema.String) })]).annotate({
	identifier: "Scope",
});
const scopeOff = Scope.pipe(Schema.withDecodingDefaultKey(Effect.succeed<typeof Scope.Type>(false)));

const Cleanup = Schema.Struct({
	secrets: scopeOff.annotate({ title: "Secrets", default: false }),
	variables: scopeOff.annotate({ title: "Variables", default: false }),
}).annotate({ identifier: "Cleanup" });

export const Output = Schema.Struct({
	$schema: Schema.Literal(OutputSchema.$id),
	name: Schema.String.annotate({ description: "What produced this output" }),
	count: Schema.optionalKey(Schema.Number),
	cleanup: Cleanup.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ secrets: false as const, variables: false as const })),
	).annotate({ title: "Cleanup" }),
	logs: scopeOff.annotate({ title: "Logs", default: false }),
}).annotate({ description: "One output file of the schema-consumer fixture" });

if (import.meta.main) {
	console.log(JSON.stringify({ $schema: OutputSchema.$id, name: "fixture", count: 1 }));
}
