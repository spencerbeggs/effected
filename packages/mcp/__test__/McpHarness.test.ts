import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import { McpStdio } from "../src/index.js";
import { McpHarness } from "../src/testing.js";
import { fixtureServer, fixtureServerMerged } from "./fixtures/server.js";

interface ToolResult {
	readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;

const PROTOCOLS = [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18] as const;

describe("McpHarness wire matrix", () => {
	for (const protocol of PROTOCOLS) {
		describe(protocol.protocolVersion, () => {
			it.effect("a success carries structuredContent and the same object as JSON text", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(fixtureServer(), { protocol });
					yield* harness.initialize;
					const result = resultOf(yield* harness.callTool("echo", { text: "hi" }));
					assert.deepStrictEqual(result.structuredContent, { text: "hi" });
					assert.strictEqual(result.content[0]?.text, JSON.stringify({ text: "hi" }));
					assert.notStrictEqual(result.isError, true);
				}),
			);

			it.effect("a declared failure is isError text with the remediation folded in, and no structuredContent", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(fixtureServer(), { protocol });
					yield* harness.initialize;
					const result = resultOf(yield* harness.callTool("lookup", { id: "nope" }));
					assert.isTrue(result.isError);
					assert.strictEqual(result.content[0]?.text, 'No thing "nope". Check the id. Try list_things.');
					assert.isUndefined(result.structuredContent);
				}),
			);

			it.effect("invalid params: JSON-RPC -32602 on 2025-06-18, an isError result on the later revisions", () =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(fixtureServer(), { protocol });
					yield* harness.initialize;
					const response = yield* harness.callTool("echo", { text: 42 });
					if (protocol.protocolVersion === "2025-06-18") {
						assert.strictEqual((response.error as { readonly code: number }).code, -32602);
						assert.isUndefined(response.result);
					} else {
						assert.isUndefined(response.error);
						assert.isTrue(resultOf(response).isError);
					}
				}),
			);
		});
	}
});

describe("McpHarness", () => {
	it.effect("a zero-parameter tool round-trips an empty arguments object", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("ping")).structuredContent, { pong: true });
		}),
	);

	it.effect("a handler defect is scrubbed on the wire and logged on stderr, never through console.log", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const result = resultOf(yield* harness.callTool("boom"));
			assert.strictEqual(result.content[0]?.text, "Tool execution failed due to an internal server error.");
			assert.include(yield* harness.stderrSoFar, "kaboom");
			assert.deepStrictEqual(yield* harness.consoleLogSoFar, []);
		}),
	);

	it.effect("the same holds when the toolkit is merged beside McpStdio.layer instead of provided with it", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServerMerged());
			yield* harness.initialize;
			yield* harness.callTool("boom");
			assert.include(yield* harness.stderrSoFar, "kaboom");
			assert.deepStrictEqual(yield* harness.consoleLogSoFar, []);
		}),
	);

	it.effect("closing stdin mid-request fails the pending call with ServerStopped instead of hanging", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const pending = yield* harness.startRequest("tools/call", { name: "hang", arguments: {} });
			yield* harness.close;
			const failure = yield* Effect.flip(pending.response);
			assert.strictEqual(failure.reason, "ServerStopped");
		}),
	);

	it.effect("strictStdout: a stray non-JSON-RPC stdout line is a defect", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const exit = yield* Effect.exit(harness.callTool("garble"));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		}),
	);

	it.effect("strictStdout false: the stray line is skipped and the call completes (positive control)", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer(), { strictStdout: false });
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("garble")).structuredContent, { ok: true });
		}),
	);

	it.effect("a server layer that fails to build fails make with that error instead of hanging", () =>
		Effect.gen(function* () {
			const broken = Layer.mergeAll(
				McpStdio.layer({ name: "broken", version: "0.0.0" }),
				Layer.effectDiscard(Effect.fail(new Error("no config"))),
			);
			const failure = yield* Effect.flip(McpHarness.make(broken));
			assert.strictEqual(failure.message, "no config");
		}),
	);

	it.live("awaitOutboundMethod returns a server notification that interleaves with responses", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			yield* harness.callTool("grow");
			const notification = yield* harness
				.awaitOutboundMethod("notifications/tools/list_changed")
				.pipe(Effect.timeout("5 seconds"));
			assert.strictEqual(notification.method, "notifications/tools/list_changed");
		}),
	);
});
