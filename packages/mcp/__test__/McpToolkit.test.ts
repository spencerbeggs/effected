import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import type { McpToolkitOptions } from "../src/index.js";
import { McpStdio, McpToolkit, ToolInputSchema } from "../src/index.js";
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

// The documented ToolInputSchema recipe: a raw top-level union, object-rooted, served as a
// Tool.dynamic tool, whose handler walks the raw payload against the schema it registered.
const EditInput = ToolInputSchema.objectRooted({
	anyOf: [
		{
			type: "object",
			properties: {
				action: { const: "rename" },
				to: { type: "string" },
				options: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false },
			},
			required: ["action", "to"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { action: { const: "delete" } },
			required: ["action"],
			additionalProperties: false,
		},
	],
});
class UnknownKeys extends Schema.TaggedError<UnknownKeys>()("UnknownKeys", { message: Schema.String }) {}
const Edit = Tool.dynamic("edit", {
	description: "Rename or delete a thing.",
	parameters: EditInput,
	failure: UnknownKeys,
});
const EditTools = Toolkit.make(Edit);
const EditHandlers = EditTools.toLayer({
	edit: (payload) => {
		const levels = ToolInputSchema.unknownKeys(payload, EditInput);
		return levels.length > 0
			? Effect.fail(new UnknownKeys({ message: ToolInputSchema.formatUnknownKeys(levels) }))
			: Effect.succeed(payload);
	},
});
const editServer = McpToolkit.layer(EditTools).pipe(
	Layer.provide(EditHandlers),
	Layer.provideMerge(McpStdio.layer({ name: "toolkit-edit-test", version: "0.0.0" })),
);

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;

describe("McpToolkit.layer", () => {
	it.effect(
		"core reports every unknown key at every depth and every missing field in one response, union members included",
		() =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(strictServer());
				yield* harness.initialize;
				const result = resultOf(
					yield* harness.callTool("search", { extra: 1, filter: { kind: "tag", tag: "t", text: "sneaky" } }),
				);
				assert.isTrue(result.isError);
				assert.strictEqual(
					result.content[0]?.text,
					[
						"Invalid parameters for tool 'search': Expected no excess property",
						'  at ["extra"]',
						"Missing key",
						'  at ["query"]',
						"Expected no excess property",
						'  at ["filter"]["text"]',
						"Accepted params at the root: query, filter.",
						'Accepted params at ["filter"]: kind, tag.',
					].join("\n"),
				);
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
			assert.include(error.message, 'at ["extra"]');
			assert.include(error.message, 'at ["filter"]["tag"]');
			assert.include(error.message, "\nAccepted params at the root: query, filter.");
			assert.include(error.message, '\nAccepted params at ["filter"]: kind, text.');
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
			assert.include(tight.content[0]?.text ?? "", 'at ["a"]');
			assert.include(tight.content[0]?.text ?? "", 'at ["b"]');
		}),
	);

	it.effect("the deprecated unknownKeyMessage is ignored", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer({ strict: "all", unknownKeyMessage: () => "nope" }));
			yield* harness.initialize;
			assert.strictEqual(
				resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).content[0]?.text,
				"Invalid parameters for tool 'search': Expected no excess property\n  at [\"extra\"]\nAccepted params at the root: query, filter.",
			);
		}),
	);

	it.effect("a zero-parameter tool says it accepts no params", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			const text = resultOf(yield* harness.callTool("stamp", { bogus: 1 })).content[0]?.text ?? "";
			assert.strictEqual(
				text,
				"Invalid parameters for tool 'stamp': Expected never\n  at [\"bogus\"]\nThis tool accepts no params.",
			);
		}),
	);

	it.effect("appends nothing when no key is unknown: a missing field is core's report alone", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(strictServer());
			yield* harness.initialize;
			assert.strictEqual(
				resultOf(yield* harness.callTool("search", {})).content[0]?.text,
				"Invalid parameters for tool 'search': Missing key\n  at [\"query\"]",
			);
			// Control: a lenient tool's own decode failure is left alone too.
			assert.strictEqual(
				resultOf(yield* harness.callTool("loose", { extra: 1 })).content[0]?.text,
				"Invalid parameters for tool 'loose': Missing key\n  at [\"query\"]",
			);
		}),
	);

	it.effect("names the accepted key patterns of a pattern-keyed Record", () =>
		Effect.gen(function* () {
			const Env = Tool.make("env", {
				parameters: Schema.Struct({
					env: Schema.Record(Schema.String.check(Schema.isPattern(/^X_[A-Z]+$/u)), Schema.String),
				}),
				success: Schema.String,
			});
			const EnvKit = Toolkit.make(Env);
			const server = McpToolkit.layer(EnvKit).pipe(
				Layer.provide(EnvKit.toLayer({ env: () => Effect.succeed("ok") })),
				Layer.provideMerge(McpStdio.layer({ name: "toolkit-env-test", version: "0.0.0" })),
			);
			const harness = yield* McpHarness.make(server);
			yield* harness.initialize;
			assert.strictEqual(
				resultOf(yield* harness.callTool("env", { env: { X_A: "1", lower: "2" }, extra: 1 })).content[0]?.text,
				[
					"Invalid parameters for tool 'env': Expected no excess property",
					'  at ["extra"]',
					"Expected no excess property",
					'  at ["env"]["lower"]',
					"Accepted params at the root: env.",
					'Accepted params at ["env"]: keys matching ^X_[A-Z]+$.',
				].join("\n"),
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
			assert.include(result.content[0]?.text ?? "", 'at ["filter"]["text"]');
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

	it.effect("a lenient tool whose raw schema is closed is never rejected", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(dynamicServer);
			yield* harness.initialize;
			for (const name of ["raw_closed", "raw_closed_loose"]) {
				const result = resultOf(yield* harness.callTool(name, { query: "q", extra: 1 }));
				assert.notStrictEqual(result.isError, true, name);
				assert.deepStrictEqual(result.structuredContent, { query: "q", extra: 1 }, name);
			}
			// Control: the same server still rejects on its strict tool.
			assert.isTrue(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).isError);
		}),
	);

	it.effect("a throwing deprecated unknownKeyMessage is never called", () =>
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
			assert.isUndefined(failed.error);
			assert.isTrue(resultOf(failed).isError);
			assert.deepStrictEqual(resultOf(yield* harness.callTool("search", { query: "q" })).structuredContent, {
				query: "q",
			});
		}),
	);

	// DEFAULT is "all": Claude Code 2.1.281 sends exactly the declared keys in `arguments`, so strict rejects nothing it sends.
	it.effect("by default an unannotated tool is strict", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(serve(McpToolkit.layer(Kit)));
			yield* harness.initialize;
			assert.isTrue(resultOf(yield* harness.callTool("search", { query: "q", extra: 1 })).isError);
		}),
	);

	it.effect("recipe: a Tool.dynamic handler walks its raw payload against the objectRooted schema it registered", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(editServer);
			yield* harness.initialize;
			// Served object-rooted: core would die at boot on the unrewritten union root.
			const [served] = yield* harness.listTools;
			assert.strictEqual(served?.inputSchema.type, "object");
			assert.strictEqual(served?.inputSchema["x-discriminator"], "action");

			const rejected = resultOf(
				yield* harness.callTool("edit", { action: "rename", to: "b", extra: 1, options: { force: true, bogus: 2 } }),
			);
			assert.isTrue(rejected.isError);
			assert.strictEqual(
				rejected.content[0]?.text,
				"Unrecognized parameter(s): extra. Accepted params: action, to, options. Unrecognized parameter(s): options.bogus. Accepted params: force.",
			);
			// The second union member is selected by its discriminant, not by position.
			const deleted = resultOf(yield* harness.callTool("edit", { action: "delete", to: "b" }));
			assert.strictEqual(deleted.content[0]?.text, "Unrecognized parameter(s): to. Accepted params: action.");
			// Control: a clean payload reaches the handler's success path.
			const clean = resultOf(yield* harness.callTool("edit", { action: "delete" }));
			assert.notStrictEqual(clean.isError, true);
			assert.deepStrictEqual(clean.structuredContent, { action: "delete" });
		}),
	);
});
