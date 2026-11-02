import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import { McpStdio, ToolFailure, ToolRefusal } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

const remediation = { hint: "List the runs first.", suggestedTool: "list_runs" };

const Declared = Tool.make("declared", {
	description: "Refuses with a declared ToolRefusal.",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ ok: Schema.Boolean }),
	failure: ToolRefusal,
});
const Undeclared = Tool.make("undeclared", {
	description: "Fails with a ToolRefusal it never declared.",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ ok: Schema.Boolean }),
});
class RichRefusal extends Schema.TaggedError<RichRefusal>()("RichRefusal", {
	...ToolFailure.fields,
	valid: Schema.Array(Schema.String),
}) {}
const ReturnMode = Tool.make("return_mode", {
	description: "Refuses with a structured failure under failureMode return.",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ ok: Schema.Boolean }),
	failure: RichRefusal,
	failureMode: "return",
});
const ErrorMode = Tool.make("error_mode", {
	description: "Refuses with the same structured failure under failureMode error.",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ ok: Schema.Boolean }),
	failure: RichRefusal,
});
const Succeeds = Tool.make("succeeds", {
	description: "Succeeds, so structuredContent is observable at all (control).",
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ ok: Schema.Boolean }),
});
const rich = () => new RichRefusal({ message: "No run.", remediation, valid: ["a", "b"] });
const Kit = Toolkit.make(Declared, Undeclared, ReturnMode, ErrorMode, Succeeds);
const server = McpServer.toolkit(Kit).pipe(
	Layer.provide(
		Kit.toLayer({
			declared: ({ id }) => ToolRefusal.refuse(`No run "${ToolFailure.truncate(id)}".`, remediation),
			undeclared: ({ id }) =>
				Effect.fail(ToolRefusal.refuse(`No run "${id}".`, remediation)) as unknown as Effect.Effect<{ ok: boolean }>,
			return_mode: () => Effect.fail(rich()),
			error_mode: () => Effect.fail(rich()),
			succeeds: () => Effect.succeed({ ok: true }),
		}),
	),
	Layer.provideMerge(McpStdio.layer({ name: "refusal", version: "0.0.0" })),
);

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly text?: string }>;
	readonly isError?: boolean;
	readonly structuredContent?: unknown;
}

describe("ToolRefusal", () => {
	it("refuse folds the remediation into the message and keeps it as a field", () => {
		const refusal = ToolRefusal.refuse('No run "x".', remediation);
		assert.strictEqual(refusal._tag, "ToolRefusal");
		assert.strictEqual(refusal.message, 'No run "x". List the runs first. Try list_runs.');
		assert.deepStrictEqual(refusal.remediation, remediation);
		assert.instanceOf(refusal, Error);
	});

	it("refuse without a suggested tool drops the Try clause", () => {
		assert.strictEqual(ToolRefusal.refuse("Busy.", { hint: "Retry later." }).message, "Busy. Retry later.");
	});

	it("round-trips through its schema", () => {
		const refusal = ToolRefusal.refuse("Nope.", remediation);
		const encoded = Schema.encodeSync(ToolRefusal)(refusal);
		const decoded = Schema.decodeUnknownSync(ToolRefusal)(encoded);
		assert.instanceOf(decoded, ToolRefusal);
		assert.strictEqual(decoded.message, refusal.message);
	});

	for (const protocol of [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2026_07_28]) {
		it.effect(`${protocol.protocolVersion}: declared, the folded message reaches the agent as isError text`, () =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(server, { protocol });
				yield* harness.initialize;
				const result = (yield* harness.callTool("declared", { id: "r1" })).result as ToolResult;
				assert.isTrue(result.isError);
				assert.strictEqual(result.content[0]?.text, 'No run "r1". List the runs first. Try list_runs.');
				assert.isUndefined(result.structuredContent);
			}),
		);

		// Why ToolRefusal.refuse takes no data argument: no failure mode delivers structuredContent.
		it.effect(`${protocol.protocolVersion}: structured failure data never reaches structuredContent`, () =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(server, { protocol });
				yield* harness.initialize;
				const control = (yield* harness.callTool("succeeds", { id: "r1" })).result as ToolResult;
				assert.deepStrictEqual(control.structuredContent, { ok: true }, "the harness does see structuredContent");
				const error = (yield* harness.callTool("error_mode", { id: "r1" })).result as ToolResult;
				assert.isTrue(error.isError);
				assert.strictEqual(error.content[0]?.text, "No run.");
				assert.isUndefined(error.structuredContent);
				const returned = (yield* harness.callTool("return_mode", { id: "r1" })).result as ToolResult;
				assert.isTrue(returned.isError);
				assert.isUndefined(returned.structuredContent);
				assert.deepStrictEqual(JSON.parse(returned.content[0]?.text ?? "null"), {
					_tag: "RichRefusal",
					message: "No run.",
					remediation,
					valid: ["a", "b"],
				});
			}),
		);

		it.effect(`${protocol.protocolVersion}: undeclared, core scrubs the message (why declaring matters)`, () =>
			Effect.gen(function* () {
				const harness = yield* McpHarness.make(server, { protocol });
				yield* harness.initialize;
				const result = (yield* harness.callTool("undeclared", { id: "r1" })).result as ToolResult;
				assert.isTrue(result.isError);
				assert.notInclude(result.content[0]?.text ?? "", "List the runs first");
				assert.include(result.content[0]?.text ?? "", "internal server error");
			}),
		);
	}
});
