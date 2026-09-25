import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
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
const Kit = Toolkit.make(Declared, Undeclared);
const server = McpServer.toolkit(Kit).pipe(
	Layer.provide(
		Kit.toLayer({
			declared: ({ id }) => ToolRefusal.refuse(`No run "${ToolFailure.truncate(id)}".`, remediation),
			undeclared: ({ id }) =>
				Effect.fail(ToolRefusal.refuse(`No run "${id}".`, remediation)) as unknown as Effect.Effect<{ ok: boolean }>,
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
