import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import type { McpToolkitOptions } from "../src/index.js";
import { McpStdio, McpToolkit } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

class Stamper extends Context.Service<Stamper, { readonly now: () => string }>()("test/Stamper") {}

const Filter = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("tag"), tag: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
]);
const Search = Tool.make("search", {
	description: "Search things.",
	parameters: Schema.Struct({ query: Schema.String, filter: Schema.optionalKey(Filter) }),
	success: Schema.Struct({ query: Schema.String }),
});
const Stamp = Tool.make("stamp", { success: Schema.Struct({ at: Schema.String }), dependencies: [Stamper] });
const Loose = Tool.make("loose", {
	parameters: Schema.Struct({ query: Schema.String }),
	success: Schema.Struct({ query: Schema.String }),
}).annotate(Tool.Strict, false);
const Tight = Tool.make("tight", {
	parameters: Schema.Struct({ query: Schema.String }),
	success: Schema.Struct({ query: Schema.String }),
}).annotate(Tool.Strict, true);

const Kit = Toolkit.make(Search, Stamp, Loose, Tight);
const Handlers = Kit.toLayer({
	search: ({ query }) => Effect.succeed({ query }),
	stamp: () =>
		Effect.gen(function* () {
			const stamper = yield* Stamper;
			return { at: stamper.now() };
		}),
	loose: ({ query }) => Effect.succeed({ query }),
	tight: ({ query }) => Effect.succeed({ query }),
});

const serve = <E, R>(registration: Layer.Layer<never, E, R>) =>
	registration.pipe(
		Layer.provide(Handlers),
		Layer.provide(Layer.succeed(Stamper, { now: () => "2026-09-23" })),
		Layer.provideMerge(McpStdio.layer({ name: "toolkit-test", version: "0.0.0" })),
	);
const strictServer = (options: McpToolkitOptions = { strict: "all" }) => serve(McpToolkit.layer(Kit, options));

// Raw-JSON-Schema dynamic tools: core decodes these leniently and dies at registration if one is strict.
const RawOpen = Tool.dynamic("raw_open", {
	parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
});
const RawClosed = Tool.dynamic("raw_closed", {
	parameters: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
		additionalProperties: false,
	},
});
const RawClosedLoose = Tool.dynamic("raw_closed_loose", {
	parameters: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
		additionalProperties: false,
	},
}).annotate(Tool.Strict, false);
const DynamicKit = Toolkit.make(RawOpen, RawClosed, RawClosedLoose, Search);
const DynamicHandlers = DynamicKit.toLayer({
	raw_open: (params) => Effect.succeed(params),
	raw_closed: (params) => Effect.succeed(params),
	raw_closed_loose: (params) => Effect.succeed(params),
	search: ({ query }) => Effect.succeed({ query }),
});
const dynamicServer = McpToolkit.layer(DynamicKit).pipe(
	Layer.provide(DynamicHandlers),
	Layer.provideMerge(McpStdio.layer({ name: "toolkit-dynamic-test", version: "0.0.0" })),
);

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;

describe("McpToolkit.layer", () => {
	it.effect(
		"rejects every unknown key at every depth in one response, including inside the selected union member",
		() =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(strictServer());
				yield* harness.initialize;
				const result = resultOf(
					yield* harness.callTool("search", {
						query: "q",
						extra: 1,
						filter: { kind: "tag", tag: "t", text: "sneaky" },
					}),
				);
				assert.isTrue(result.isError);
				const text = result.content[0]?.text ?? "";
				assert.include(text, "Unrecognized parameter(s): extra.");
				assert.include(text, "filter.text");
			}),
	);

	it.effect("is a JSON-RPC -32602 error naming every key on 2025-06-18", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer(), { protocol: McpProtocol.v2025_06_18 });
			yield* harness.initialize;
			const response = yield* harness.callTool("search", {
				query: "q",
				extra: 1,
				filter: { kind: "text", text: "x", tag: "y" },
			});
			const error = response.error as { readonly code: number; readonly message: string };
			assert.strictEqual(error.code, -32602);
			assert.include(error.message, "extra");
			assert.include(error.message, "filter.tag");
		}),
	);

	it.effect("a valid call still reaches the handler matched by tool id", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			assert.deepStrictEqual(
				resultOf(yield* harness.callTool("search", { query: "q", filter: { kind: "text", text: "x" } }))
					.structuredContent,
				{ query: "q" },
			);
		}),
	);

	it.effect("a handler dependency resolves", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("stamp")).structuredContent, { at: "2026-09-23" });
		}),
	);

	it.effect("an explicit Tool.Strict false stays open even under strict all", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("loose", { query: "q", extra: 1 })).structuredContent, {
				query: "q",
			});
		}),
	);

	it.effect("serves nested objects closed under strict all, and the opted-out tool open", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			const tools = yield* harness.listTools;
			const search = tools.find((tool) => tool.name === "search")?.inputSchema ?? {};
			assert.strictEqual(search.additionalProperties, false);
			const filter = (
				search.properties as { readonly filter: { readonly anyOf: ReadonlyArray<Record<string, unknown>> } }
			).filter;
			assert.deepStrictEqual(
				filter.anyOf.map((member) => member.additionalProperties),
				[false, false],
			);
			const loose = tools.find((tool) => tool.name === "loose")?.inputSchema ?? {};
			assert.notStrictEqual(loose.additionalProperties, false);
		}),
	);

	it.effect("strict annotated leaves an unannotated tool open and still names every key for an annotated one", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer({ strict: "annotated" }));
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).structuredContent, {
				query: "q",
			});
			const tight = resultOf(yield* harness.callTool("tight", { query: "q", a: 1, b: 2 }));
			assert.isTrue(tight.isError);
			assert.include(tight.content[0]?.text ?? "", "a, b");
		}),
	);

	it.effect("unknownKeyMessage replaces the rendered message", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				strictServer({
					strict: "all",
					unknownKeyMessage: (levels) => `nope: ${levels.flatMap((level) => level.unknown).join("|")}`,
				}),
			);
			yield* harness.initialize;
			assert.strictEqual(
				resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).content[0]?.text,
				"nope: extra",
			);
		}),
	);

	it.effect("control: plain McpServer.toolkit drops the same unknown keys silently", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(serve(McpServer.toolkit(Kit)));
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).structuredContent, {
				query: "q",
			});
		}),
	);

	it.effect("names a nested union-member key on 2026-07-28, the revision Claude Code negotiates", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer(), { protocol: McpProtocol.v2026_07_28 });
			yield* harness.initialize;
			const result = resultOf(
				yield* harness.callTool("search", { query: "q", filter: { kind: "tag", tag: "t", text: "sneaky" } }),
			);
			assert.isTrue(result.isError);
			assert.include(result.content[0]?.text ?? "", "filter.text");
		}),
	);

	it.effect("a dynamic raw-schema tool is left lenient under the default, registers, and accepts an extra key", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(dynamicServer);
			yield* harness.initialize;
			const result = resultOf(yield* harness.callTool("raw_open", { query: "q", extra: 1 }));
			assert.notStrictEqual(result.isError, true);
			assert.deepStrictEqual(result.structuredContent, { query: "q", extra: 1 });
		}),
	);

	it.effect("a lenient tool whose raw schema is closed is never rejected by the pre-check", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(dynamicServer);
			yield* harness.initialize;
			for (const name of ["raw_closed", "raw_closed_loose"]) {
				const result = resultOf(yield* harness.callTool(name, { query: "q", extra: 1 }));
				assert.notStrictEqual(result.isError, true, name);
				assert.deepStrictEqual(result.structuredContent, { query: "q", extra: 1 }, name);
			}
			// Control: the same server still pre-checks its strict tool.
			assert.isTrue(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).isError);
		}),
	);

	it.effect("a throwing unknownKeyMessage fails only that call, and the server keeps answering", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				strictServer({
					strict: "all",
					unknownKeyMessage: () => {
						throw new Error("formatter bug");
					},
				}),
			);
			yield* harness.initialize;
			const failed = yield* harness.callTool("search", { query: "q", extra: 1 });
			assert.strictEqual((failed.error as { readonly code: number }).code, -32603);
			assert.deepStrictEqual(resultOf(yield* harness.callTool("search", { query: "q" })).structuredContent, {
				query: "q",
			});
		}),
	);

	// DEFAULT — probe P2 outcome O1 (Claude Code 2.1.281 sends exactly the declared keys in `arguments`): "all".
	it.effect("by default an unannotated tool is strict", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(serve(McpToolkit.layer(Kit)));
			yield* harness.initialize;
			assert.isTrue(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).isError);
		}),
	);
});
