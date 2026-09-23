import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
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
		["a missing outputSchema", { ...clean, outputSchema: undefined }, strictest, ["get_thing: no outputSchema"]],
		[
			"a non-object output root, by default (D10)",
			{ ...clean, outputSchema: { type: "string" } },
			{ input: "any" },
			["get_thing: outputSchema is not object-rooted (root type: string)"],
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
	];
	for (const [label, tool, policy, expected] of cases) {
		it(label, () => {
			assert.deepStrictEqual(McpToolAudit.check([tool], policy), expected);
		});
	}

	it("a duplicate tool name is reported under every policy", () => {
		assert.deepStrictEqual(McpToolAudit.check([clean, clean], { input: "any" }), ["get_thing: duplicate tool name"]);
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
