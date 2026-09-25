import { assert, describe, it } from "@effect/vitest";
import type { JsonSchema } from "effect";
import { Context, Effect, Layer, Schema } from "effect";
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import type { UnionTool } from "../src/index.js";
import { McpStdio, McpToolkit, ToolInputSchema, ToolOutputSchema, ToolRefusal } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

class Clock extends Context.Service<Clock, { readonly now: () => string }>()("test/UnionClock") {}

const Citation = Schema.Struct({ id: Schema.String, line: Schema.Number }).annotate({ identifier: "Citation" });
const Record = Schema.Struct({
	action: Schema.Literal("record"),
	content: Schema.String,
	citations: Schema.optionalKey(Schema.Array(Citation)),
});
const List = Schema.Struct({ action: Schema.Literal("list"), limit: Schema.optionalKey(Schema.Number) });
const Refuse = Schema.Struct({ action: Schema.Literal("refuse"), id: Schema.String });
const NoteInput = Schema.Union([Record, List, Refuse]);

const Recorded = Schema.Struct({ kind: Schema.Literal("recorded"), content: Schema.String, at: Schema.String });
const Listed = Schema.Struct({ kind: Schema.Literal("listed"), limit: Schema.Number });
const NoteResult = ToolOutputSchema.objectRooted(Schema.Union([Recorded, Listed]));

const Note = McpToolkit.unionTool("note", {
	description: "Manage notes by action.",
	parameters: NoteInput,
	success: NoteResult,
	failure: ToolRefusal,
	dependencies: [Clock],
})
	.annotate(Tool.Title, "Note")
	.annotate(Tool.Readonly, false);

// Compile-time: `dependencies` infers the service identifier exactly, not `unknown`.
type NoteRequirements =
	typeof Note extends UnionTool<string, typeof NoteInput, typeof NoteResult, typeof ToolRefusal, infer R> ? R : never;
export const dependenciesInferExactly: [NoteRequirements] extends [Clock]
	? [Clock] extends [NoteRequirements]
		? true
		: false
	: false = true;

const Echo = Tool.make("echo", {
	parameters: Schema.Struct({ text: Schema.String }),
	success: Schema.Struct({ text: Schema.String }),
});

const Kit = Toolkit.make(Note, Echo);
const Handlers = Kit.toLayer({
	// Chained `.annotate` kept the union: `params` is the decoded member, not `unknown`.
	note: McpToolkit.unionHandler(Note, (params) =>
		Effect.gen(function* () {
			if (params.action === "refuse") {
				return yield* ToolRefusal.refuse(`No note "${params.id}".`, { hint: "List notes first." });
			}
			if (params.action === "list") return { kind: "listed" as const, limit: params.limit ?? 10 };
			const clock = yield* Clock;
			return { kind: "recorded" as const, content: params.content, at: clock.now() };
		}),
	),
	echo: ({ text }) => Effect.succeed({ text }),
});

const serve = <E, R>(registration: Layer.Layer<never, E, R>) =>
	registration.pipe(
		Layer.provide(Handlers),
		Layer.provide(Layer.succeed(Clock, { now: () => "2026-09-25" })),
		Layer.provideMerge(McpStdio.layer({ name: "union-test", version: "0.0.0" })),
	);
const kitServer = serve(McpToolkit.layer(Kit));
const coreServer = serve(McpServer.toolkit(Kit));

/**
 * vitest-agent's `unionInputJsonSchema` (packages/mcp/src/tools/_union-schema.ts:47-54),
 * verbatim: the served bytes a migrating consumer must keep.
 */
const referenceInputJsonSchema = (parameters: Schema.Top): JsonSchema.JsonSchema => {
	const document = Schema.toJsonSchemaDocument(parameters, { onExcessProperty: "error" });
	return ToolInputSchema.objectRooted(
		Object.keys(document.definitions).length === 0
			? document.schema
			: { ...document.schema, $defs: document.definitions },
	);
};

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly text?: string }>;
	readonly isError?: boolean;
	readonly structuredContent?: unknown;
}
interface RpcError {
	readonly code: number;
	readonly message: string;
}

const PROTOCOLS = [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2026_07_28] as const;

/** The text an invalid call reached the client with, and how: a JSON-RPC error or an isError result. */
const rejection = (response: { readonly result?: unknown; readonly error?: unknown }) =>
	response.error !== undefined
		? { via: "error" as const, code: (response.error as RpcError).code, text: (response.error as RpcError).message }
		: {
				via: "isError" as const,
				code: undefined,
				text: (response.result as ToolResult).content[0]?.text ?? "",
				isError: (response.result as ToolResult).isError,
			};

describe("McpToolkit.unionTool", () => {
	it("keeps the union on the tool through annotate and addDependency", () => {
		assert.strictEqual(Note.unionParameters, NoteInput);
		assert.strictEqual(Note.addDependency(Clock).unionParameters, NoteInput);
		assert.strictEqual(Context.getOrUndefined(Note.annotations, Tool.Title), "Note");
	});

	it.effect("serves an input schema byte-identical to vitest-agent's pipeline", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(kitServer);
			yield* harness.initialize;
			const note = (yield* harness.listTools).find((tool) => tool.name === "note");
			const expected = JSON.parse(JSON.stringify(referenceInputJsonSchema(NoteInput)));
			assert.strictEqual(JSON.stringify(note?.inputSchema), JSON.stringify(expected));
			assert.strictEqual(note?.inputSchema.type, "object");
			assert.strictEqual(note?.inputSchema["x-discriminator"], "action");
			assert.isDefined((note?.inputSchema.$defs as Record<string, unknown> | undefined)?.Citation);
			assert.strictEqual(note?.outputSchema?.type, "object");
			assert.strictEqual(note?.title ?? note?.annotations?.title, "Note");
		}),
	);

	for (const protocol of PROTOCOLS) {
		const version = protocol.protocolVersion;
		const jsonRpc = version === "2025-06-18";

		describe(`${version}, under McpToolkit.layer`, () => {
			it.effect("hands the handler the decoded member, with its dependency provided", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(kitServer, { protocol });
					yield* harness.initialize;
					const recorded = (yield* harness.callTool("note", { action: "record", content: "hi" })).result as ToolResult;
					assert.deepStrictEqual(recorded.structuredContent, { kind: "recorded", content: "hi", at: "2026-09-25" });
					const listed = (yield* harness.callTool("note", { action: "list" })).result as ToolResult;
					assert.deepStrictEqual(listed.structuredContent, { kind: "listed", limit: 10 });
				}),
			);

			it.effect("names every unknown key, nested ones included, in one rejection", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(kitServer, { protocol });
					yield* harness.initialize;
					const got = rejection(
						yield* harness.callTool("note", {
							action: "record",
							content: "hi",
							extra: 1,
							citations: [{ id: "a", line: 1, typo: true }],
						}),
					);
					assert.strictEqual(got.via, jsonRpc ? "error" : "isError");
					if (jsonRpc) assert.strictEqual(got.code, -32602);
					assert.include(got.text, "extra");
					assert.include(got.text, "citations.0.typo");
				}),
			);

			it.effect("a bad value is rejected with core's Tool.make wording", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(kitServer, { protocol });
					yield* harness.initialize;
					const got = rejection(yield* harness.callTool("note", { action: "record", content: 42 }));
					assert.strictEqual(got.via, jsonRpc ? "error" : "isError");
					if (jsonRpc) assert.strictEqual(got.code, -32602);
					assert.include(got.text, "Invalid parameters for tool 'note':");
				}),
			);

			it.effect("rejects exactly as a Tool.make tool's decode failure does (parity)", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(kitServer, { protocol });
					yield* harness.initialize;
					const union = rejection(yield* harness.callTool("note", { action: "record", content: 42 }));
					const made = rejection(yield* harness.callTool("echo", { text: 42 }));
					assert.strictEqual(union.via, made.via);
					assert.strictEqual(union.code, made.code);
				}),
			);

			it.effect("a declared ToolRefusal from the handler is isError text", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(kitServer, { protocol });
					yield* harness.initialize;
					const result = (yield* harness.callTool("note", { action: "refuse", id: "n1" })).result as ToolResult;
					assert.isTrue(result.isError);
					assert.strictEqual(result.content[0]?.text, 'No note "n1". List notes first.');
				}),
			);
		});

		it.effect(`${version}, under core's McpServer.toolkit: still strict, but a declared isError`, () =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(coreServer, { protocol });
				yield* harness.initialize;
				const response = yield* harness.callTool("note", { action: "record", content: "hi", extra: 1 });
				assert.isUndefined(response.error);
				const result = response.result as ToolResult;
				assert.isTrue(result.isError);
				assert.strictEqual(
					result.content[0]?.text,
					"Unrecognized parameter(s): extra. Accepted params: action, content, citations.",
				);
				const badValue = (yield* harness.callTool("note", { action: "record", content: 42 })).result as ToolResult;
				assert.isTrue(badValue.isError);
				assert.include(badValue.content[0]?.text ?? "", "Invalid parameters for tool 'note':");
				assert.deepStrictEqual(
					((yield* harness.callTool("note", { action: "list", limit: 3 })).result as ToolResult).structuredContent,
					{ kind: "listed", limit: 3 },
				);
			}),
		);
	}
});

/** Unknown keys at the root and inside an array item: core's own decode names only the first. */
const TWO_LEVELS = { action: "record", content: "hi", extra: 1, citations: [{ id: "a", line: 1, typo: true }] };

describe("McpToolkit.unionHandler", () => {
	it.effect("names every unknown key, per level, in the formatUnknownKeys report", () =>
		Effect.gen(function* () {
			const handler = McpToolkit.unionHandler(Note, (params) => Effect.succeed(params.action));
			const error = yield* Effect.flip(handler(TWO_LEVELS));
			assert.instanceOf(error, McpSchema.InvalidParams);
			const expected = ToolInputSchema.formatUnknownKeys(ToolInputSchema.unknownKeys(TWO_LEVELS, Note.jsonSchema));
			assert.strictEqual(error.message, expected);
			assert.include(error.message, "extra");
			assert.include(error.message, "citations.0.typo");
			assert.notInclude(error.message, "Invalid parameters for tool");
			assert.strictEqual(yield* handler({ action: "list" }), "list");
		}),
	);

	it.effect("a bad value with no unknown key still fails in core's Tool.make wording", () =>
		Effect.gen(function* () {
			const handler = McpToolkit.unionHandler(Note, (params) => Effect.succeed(params.action));
			const error = yield* Effect.flip(handler({ action: "record", content: 42 }));
			assert.instanceOf(error, McpSchema.InvalidParams);
			assert.include(error.message, "Invalid parameters for tool 'note':");
		}),
	);

	it.effect("honours a custom unknownKeyMessage", () =>
		Effect.gen(function* () {
			const handler = McpToolkit.unionHandler(Note, (params) => Effect.succeed(params.action), {
				unknownKeyMessage: (levels) =>
					`custom:${levels.map((level) => [...level.path, ...level.unknown].join(".")).join("|")}`,
			});
			const error = yield* Effect.flip(handler(TWO_LEVELS));
			assert.strictEqual(error.message, "custom:extra|citations.0.typo");
		}),
	);

	for (const protocol of PROTOCOLS) {
		it.effect(
			`${protocol.protocolVersion}: a direct call, McpServer.toolkit and McpToolkit.layer report identically`,
			() =>
				Effect.gen(function* () {
					const handler = McpToolkit.unionHandler(Note, (params) => Effect.succeed(params.action));
					const direct = (yield* Effect.flip(handler(TWO_LEVELS))).message;
					const viaCore = yield* McpHarness.make(coreServer, { protocol });
					yield* viaCore.initialize;
					const viaLayer = yield* McpHarness.make(kitServer, { protocol });
					yield* viaLayer.initialize;
					assert.strictEqual(rejection(yield* viaCore.callTool("note", TWO_LEVELS)).text, direct);
					assert.strictEqual(rejection(yield* viaLayer.callTool("note", TWO_LEVELS)).text, direct);
				}),
		);
	}

	it.effect("treats a missing payload as an empty object", () =>
		Effect.gen(function* () {
			const handler = McpToolkit.unionHandler(Note, (params) => Effect.succeed(params.action));
			const error = yield* Effect.flip(handler(undefined));
			assert.instanceOf(error, McpSchema.InvalidParams);
		}),
	);
});
