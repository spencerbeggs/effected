import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema, SchemaAST } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { McpStdio, ToolOutputSchema } from "../src/index.js";
import { McpHarness, McpToolAudit } from "../src/testing.js";

const Found = Schema.Struct({ kind: Schema.Literal("found"), id: Schema.String });
const Missing = Schema.Struct({ kind: Schema.Literal("missing"), reason: Schema.String });
const union = () => Schema.Union([Found, Missing]);

const document = (schema: Schema.Top) => Schema.toJsonSchemaDocument(schema as Schema.Codec<unknown, unknown>);

/** A server with one tool per success schema, each returning a `found` member. */
const serve = (successes: Record<string, Schema.Codec<unknown, unknown>>) => {
	const tools = Object.entries(successes).map(([name, success]) =>
		Tool.make(name, { description: name, success: success as typeof Found }),
	);
	const kit = Toolkit.make(...tools);
	const handlers = kit.toLayer(
		Object.fromEntries(tools.map((tool) => [tool.name, () => Effect.succeed({ kind: "found", id: "x" })])) as never,
	);
	return McpServer.toolkit(kit).pipe(
		Layer.provide(handlers),
		Layer.provideMerge(McpStdio.layer({ name: "output-schema", version: "0.0.0" })),
	);
};

describe("ToolOutputSchema.objectRooted", () => {
	it("adds type object beside the anyOf at the root", () => {
		const { schema } = document(ToolOutputSchema.objectRooted(union()));
		assert.strictEqual(schema.type, "object");
		assert.lengthOf(schema.anyOf as ReadonlyArray<unknown>, 2);
	});

	it("an unwrapped union has no root type (negative control)", () => {
		assert.isUndefined(document(union()).schema.type);
	});

	it("before .annotate({ identifier }): the named definition is object-rooted", () => {
		const { schema, definitions } = document(ToolOutputSchema.objectRooted(union()).annotate({ identifier: "Result" }));
		assert.strictEqual(schema.$ref, "#/$defs/Result");
		assert.strictEqual(definitions.Result?.type, "object");
	});

	it("after .annotate({ identifier }): the same document, identifier kept", () => {
		const before = document(ToolOutputSchema.objectRooted(union()).annotate({ identifier: "Result" }));
		const after = document(ToolOutputSchema.objectRooted(union().annotate({ identifier: "Result" })));
		assert.deepStrictEqual(after, before);
	});

	it("a bare check after an identifier drops the definition name (why the identifier is carried)", () => {
		const bare = union()
			.annotate({ identifier: "Result" })
			.check(Schema.makeFilter<unknown>(() => true, { toJsonSchema: () => ({ type: "object" }) }));
		assert.isUndefined(SchemaAST.resolveIdentifier(bare.ast));
		assert.isUndefined(document(bare).schema.$ref);
	});

	it("is idempotent", () => {
		const once = ToolOutputSchema.objectRooted(union());
		assert.strictEqual(ToolOutputSchema.objectRooted(once), once);
		const named = ToolOutputSchema.objectRooted(union()).annotate({ identifier: "Result" });
		assert.strictEqual(ToolOutputSchema.objectRooted(named), named);
	});

	it("leaves decoding unchanged", () => {
		const schema = ToolOutputSchema.objectRooted(union());
		assert.deepStrictEqual(Schema.decodeUnknownSync(schema)({ kind: "missing", reason: "gone" }), {
			kind: "missing",
			reason: "gone",
		});
		assert.throws(() => Schema.decodeUnknownSync(schema)({ kind: "other" }));
	});

	for (const protocol of [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2026_07_28]) {
		it.effect(`${protocol.protocolVersion}: served as an object-rooted outputSchema in either order`, () =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(
					serve({
						bare: union(),
						rooted_first: ToolOutputSchema.objectRooted(union()).annotate({ identifier: "ResultA" }),
						named_first: ToolOutputSchema.objectRooted(union().annotate({ identifier: "ResultB" })),
					}),
					{ protocol },
				);
				yield* harness.initialize;
				const tools = yield* harness.listTools;
				const byName = (name: string) => tools.find((tool) => tool.name === name);
				for (const name of ["rooted_first", "named_first"]) {
					assert.strictEqual(byName(name)?.outputSchema?.type, "object", name);
				}
				assert.deepStrictEqual(
					McpToolAudit.check(
						tools.filter((tool) => tool.name !== "bare"),
						{ input: "any" },
					),
					[],
				);
				const call = yield* harness.callTool("named_first", {});
				assert.deepStrictEqual((call.result as { structuredContent: unknown }).structuredContent, {
					kind: "found",
					id: "x",
				});
			}),
		);
	}
});
