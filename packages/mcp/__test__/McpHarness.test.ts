import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Result } from "effect";
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

	it.live("closing stdin mid-request fails the pending call with ServerStopped instead of hanging", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const pending = yield* harness.startRequest("tools/call", { name: "hang", arguments: {} });
			yield* harness.close;
			const failure = yield* Effect.flip(pending.response).pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(failure._tag, "McpTestFailure");
			assert.strictEqual(failure._tag === "McpTestFailure" ? failure.reason : undefined, "ServerStopped");
		}),
	);

	it.live("awaitOutboundMethod after close fails with ServerStopped instead of hanging", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			yield* harness.close;
			const failure = yield* Effect.flip(harness.awaitOutboundMethod("never/sent")).pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(failure._tag, "McpTestFailure");
			assert.strictEqual(failure._tag === "McpTestFailure" ? failure.reason : undefined, "ServerStopped");
		}),
	);

	it.effect("responses are matched by id: a later request resolves while an earlier one is still pending", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const hung = yield* harness.startRequest("tools/call", { name: "hang", arguments: {} });
			const echoed = yield* harness.startRequest("tools/call", { name: "echo", arguments: { text: "second" } });
			assert.isBelow(hung.id, echoed.id);
			const response = yield* echoed.response;
			assert.strictEqual(response.id, echoed.id);
			assert.deepStrictEqual(resultOf(response).structuredContent, { text: "second" });
		}),
	);

	it.effect("positive control: a layer merged beside McpStdio.layer logs its build through console.log", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				Layer.mergeAll(
					Layer.effectDiscard(Effect.logError("build-log")),
					McpStdio.layer({ name: "merged-log", version: "0.0.0" }),
				),
			);
			assert.isTrue((yield* harness.consoleLogSoFar).some((line) => line.includes("build-log")));
			assert.notInclude(yield* harness.stderrSoFar, "build-log");
		}),
	);

	it.effect("a layer composed with provideMerge(McpStdio.layer) logs its build on stderr, never console.log", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(
				Layer.effectDiscard(Effect.logError("build-log")).pipe(
					Layer.provideMerge(McpStdio.layer({ name: "provided-log", version: "0.0.0" })),
				),
			);
			assert.include(yield* harness.stderrSoFar, "build-log");
			assert.deepStrictEqual(yield* harness.consoleLogSoFar, []);
		}),
	);

	it.effect("stateless: a caller-supplied _meta protocolVersion wins over the harness's own", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer(), { protocol: McpProtocol.v2026_07_28 });
			yield* harness.initialize;
			const response = yield* harness.request("tools/list", {
				_meta: { "io.modelcontextprotocol/protocolVersion": "1999-01-01" },
			});
			// The caller's revision reached the server: core refuses it by name instead of serving the harness's own.
			const error = response.error as {
				readonly code: number;
				readonly message: string;
				readonly data: { readonly requested: string };
			};
			assert.strictEqual(error.code, -32022);
			assert.include(error.message, "1999-01-01");
			assert.strictEqual(error.data.requested, "1999-01-01");
			assert.isUndefined(response.result);
		}),
	);

	it.effect("stateful: a request before initialize fails fast with NotInitialized, naming the revision", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer(), { protocol: McpProtocol.v2025_06_18 });
			const failure = yield* Effect.flip(harness.callTool("echo", { text: "early" }));
			assert.strictEqual(failure.reason, "NotInitialized");
			assert.include(failure.message, "call initialize first on stateful protocol 2025-06-18");
			// Not the server's opaque refusal: the request never reached it.
			assert.notInclude(failure.message, "Invalid request metadata");
			yield* harness.initialize;
			assert.deepStrictEqual(resultOf(yield* harness.callTool("echo", { text: "late" })).structuredContent, {
				text: "late",
			});
		}),
	);

	it.effect("stateless: a request needs no initialize first (positive control)", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer(), { protocol: McpProtocol.v2026_07_28 });
			assert.deepStrictEqual(resultOf(yield* harness.callTool("echo", { text: "early" })).structuredContent, {
				text: "early",
			});
		}),
	);

	it.effect("stateful: an initialize written with sendRaw is ungated and lifts the precondition", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.sendRaw({
				jsonrpc: "2.0",
				id: 50,
				method: "initialize",
				params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "0.0.0" } },
			});
			yield* harness.sendRaw({ jsonrpc: "2.0", method: "notifications/initialized" });
			assert.deepStrictEqual(resultOf(yield* harness.callTool("echo", { text: "raw" })).structuredContent, {
				text: "raw",
			});
		}),
	);

	it.effect("strictStdout: a stray non-JSON-RPC stdout line is a defect", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(fixtureServer());
			yield* harness.initialize;
			const exit = yield* Effect.exit(harness.callTool("garble"));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
			const defect = Exit.isFailure(exit) ? Result.getOrUndefined(Cause.findDefect(exit.cause)) : undefined;
			assert.include(String(defect), "not JSON-RPC");
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
				.pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(notification.method, "notifications/tools/list_changed");
		}),
	);
});
