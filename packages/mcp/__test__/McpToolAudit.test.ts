import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { McpToolAuditPolicy, ServedTool } from "../src/testing.js";
import { McpHarness, McpToolAudit } from "../src/testing.js";
import { fixtureServer } from "./fixtures/server.js";

const clean: ServedTool = {
	name: "get_thing",
	title: "Get a thing",
	description: "Fetch one thing by id.",
	inputSchema: {
		type: "object",
		properties: { id: { type: "string" } },
		required: ["id"],
		additionalProperties: false,
	},
	outputSchema: { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
const strictest: McpToolAuditPolicy = {
	input: "closed",
	requireTitle: true,
	requireOutputSchema: true,
	maxDescription: 400,
	requireHints: true,
};

describe("McpToolAudit.check fixtures, each wrong in exactly one way", () => {
	it("the clean fixture passes the strictest policy — or every case below proves nothing", () => {
		assert.deepStrictEqual(McpToolAudit.check([clean], strictest), []);
	});

	const cases: ReadonlyArray<readonly [string, ServedTool, McpToolAuditPolicy, ReadonlyArray<string>]> = [
		[
			"an open nested object under the closed policy",
			{
				...clean,
				inputSchema: {
					...clean.inputSchema,
					properties: { id: { type: "string" }, filter: { type: "object", properties: { tag: { type: "string" } } } },
				},
			},
			strictest,
			["get_thing: input schema is open at filter"],
		],
		[
			"a closed root under the open policy",
			clean,
			{ input: "open" },
			["get_thing: input schema is closed at the root"],
		],
		[
			"a zero-parameter tool is not 'closed' under the open policy",
			{ ...clean, inputSchema: { type: "object", additionalProperties: false } },
			{ input: "open" },
			[],
		],
		["a missing title", { ...clean, title: undefined }, strictest, ["get_thing: no title"]],
		[
			"a title carried only in annotations counts",
			{ ...clean, title: undefined, annotations: { ...clean.annotations, title: "T" } },
			strictest,
			[],
		],
		[
			"a missing outputSchema",
			{ ...clean, outputSchema: undefined },
			strictest,
			[
				"get_thing: no outputSchema (a union success schema is dropped on stateful revisions; see ToolOutputSchema.objectRooted)",
			],
		],
		[
			"a non-object output root, by default (D10)",
			{ ...clean, outputSchema: { type: "string" } },
			{ input: "any" },
			["get_thing: outputSchema is not object-rooted (root type: string)"],
		],
		[
			"a union output root names the ToolOutputSchema.objectRooted fix",
			{ ...clean, outputSchema: { anyOf: [{ type: "object" }, { type: "object" }] } },
			{ input: "any" },
			[
				"get_thing: outputSchema is not object-rooted (root type: none); wrap the union success schema in ToolOutputSchema.objectRooted",
			],
		],
		[
			"a oneOf output root names the ToolOutputSchema.objectRooted fix too",
			{ ...clean, outputSchema: { oneOf: [{ type: "object" }, { type: "object" }] } },
			{ input: "any" },
			[
				"get_thing: outputSchema is not object-rooted (root type: none); wrap the union success schema in ToolOutputSchema.objectRooted",
			],
		],
		[
			"the same output root with objectRootedOutput opted out",
			{ ...clean, outputSchema: { type: "string" } },
			{ input: "any", objectRootedOutput: false },
			[],
		],
		[
			"a description over the limit",
			{ ...clean, description: "d".repeat(401) },
			strictest,
			["get_thing: description is 401 characters, over the 400 limit"],
		],
		[
			"a missing hint",
			{ ...clean, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
			strictest,
			["get_thing: missing annotation hints: openWorldHint"],
		],
		[
			"input any ignores openness",
			{ ...clean, inputSchema: { type: "object", properties: { id: { type: "string" } } } },
			{ input: "any" },
			[],
		],
		[
			// Core serves exactly this shape for a Struct field typed `Schema.Record(Schema.String, X)`
			// (`toJsonSchemaDocument.ts` ~495-508): no `properties` key on the field's own node, and
			// `additionalProperties` set to the value schema rather than to `true`/`false`. Only an
			// explicit `false` may close a node — a schema value is open, the same as a missing key.
			"a field shaped like a Schema.Record is open even though its own additionalProperties is a schema, not a boolean",
			{
				...clean,
				inputSchema: {
					type: "object",
					properties: { id: { type: "string" }, tags: { type: "object", additionalProperties: { type: "string" } } },
					required: ["id"],
					additionalProperties: false,
				},
			},
			strictest,
			["get_thing: input schema is open at tags"],
		],
		[
			// Core never emits two `allOf` members that EACH declare `properties`, but `allOf: [Base,
			// Extension]` is an ordinary hand-authored idiom, and McpToolAudit sweeps any served server,
			// not just core-generated ones. `wrapper` itself stays closed (its own `additionalProperties`
			// is `false`), isolating the assertion to whether the SECOND branch's `b` is found at all.
			"properties declared in a SECOND allOf branch are folded in and recursed into, not lost to the first",
			{
				...clean,
				inputSchema: {
					...clean.inputSchema,
					properties: {
						id: { type: "string" },
						wrapper: {
							type: "object",
							additionalProperties: false,
							allOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { type: "object" } } }],
						},
					},
				},
			},
			strictest,
			["get_thing: input schema is open at wrapper.b"],
		],
	];
	for (const [label, tool, policy, expected] of cases) {
		it(label, () => {
			assert.deepStrictEqual(McpToolAudit.check([tool], policy), expected);
		});
	}

	it("a duplicate tool name is reported under every policy", () => {
		assert.deepStrictEqual(McpToolAudit.check([clean, clean], { input: "any" }), ["get_thing: duplicate tool name"]);
	});

	it("a Struct + Record merged at the SAME level — core's allOf wrapper — is open, and only once", () => {
		// `Schema.StructWithRest` merges declared `properties` with a Record's `additionalProperties`
		// via `allOf` (`toJsonSchemaDocument.ts` ~509-510) rather than putting `additionalProperties`
		// directly on the root node. The allOf member is a keyword-merge artifact on the SAME object,
		// not a second shape — it must not be reported as its own open node alongside the root.
		const merged = Schema.toJsonSchemaDocument(
			Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.String)]),
		).schema;
		assert.deepStrictEqual(
			McpToolAudit.check([{ ...clean, name: "merged_thing", inputSchema: merged }], { input: "closed" }),
			["merged_thing: input schema is open at the root"],
		);
	});
});

describe("McpToolAudit.check against a real served tools/list", () => {
	it.effect("flags the lenient tools and the bare-string output served by the stateless adapter", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer(), { protocol: McpProtocol.v2026_07_28 });
			const tools = yield* harness.listTools;
			assert.deepStrictEqual([...McpToolAudit.check(tools, { input: "closed" })].sort(), [
				"echo: input schema is open at the root",
				"lookup: input schema is open at the root",
				"version: outputSchema is not object-rooted (root type: string)",
			]);
			assert.deepStrictEqual(
				McpToolAudit.check(
					tools.filter((tool) => tool.name === "version"),
					{ input: "any", objectRootedOutput: false },
				),
				[],
			);
		}),
	);
});
