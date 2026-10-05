import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { LspTestFailure } from "../src/testing.js";
import { LspProbe } from "../src/testing.js";
import { fakeLspCommand as command } from "./helpers/fakeLsp.js";

const reasonOf = (failure: LspTestFailure | { readonly _tag: string }) =>
	failure._tag === "LspTestFailure" ? (failure as LspTestFailure).reason : failure._tag;

// The probe's timeout reads Clock, so every test runs under the real clock (`it.live`).
describe("LspProbe.initialize", () => {
	it.live("runs initialize, initialized, shutdown, exit and exits 0", () =>
		Effect.gen(function* () {
			const result = yield* LspProbe.initialize(yield* command());
			assert.strictEqual(result.response.id, 1);
			assert.isUndefined(result.response.error);
			const server = result.response.result as { readonly serverInfo: { readonly name: string } };
			assert.strictEqual(server.serverInfo.name, "fake-lsp ✓ 🚀");
			assert.deepStrictEqual(result.shutdown, { jsonrpc: "2.0", id: 2, result: null });
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			const received = result.messages.find((message) => message.method === "fixture/received");
			assert.deepStrictEqual(received?.params, { methods: ["initialize", "initialized", "shutdown"] });
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("records every server message in order, a server request included, and answers none", () =>
		Effect.gen(function* () {
			const result = yield* LspProbe.initialize(yield* command());
			assert.deepStrictEqual(
				result.messages.map((message) => message.method ?? `response ${String(message.id)}`),
				["window/logMessage", "response 1", "client/registerCapability", "fixture/received", "response 2"],
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("sends the default initialize params, and the caller's when given", () =>
		Effect.gen(function* () {
			const defaults = yield* LspProbe.initialize(yield* command());
			assert.deepStrictEqual((defaults.response.result as { readonly echoed: unknown }).echoed, {
				processId: null,
				rootUri: null,
				capabilities: {},
			});
			const given = yield* LspProbe.initialize(yield* command(), {
				rootUri: "file:///work",
				processId: 42,
				capabilities: { workspace: { configuration: true } },
				initializationOptions: { mode: "probe" },
			});
			assert.deepStrictEqual((given.response.result as { readonly echoed: unknown }).echoed, {
				processId: 42,
				rootUri: "file:///work",
				capabilities: { workspace: { configuration: true } },
				initializationOptions: { mode: "probe" },
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("reads frames a server writes three bytes at a time", () =>
		Effect.gen(function* () {
			const result = yield* LspProbe.initialize(yield* command("--split"));
			assert.strictEqual(
				(result.response.result as { readonly serverInfo: { readonly name: string } }).serverInfo.name,
				"fake-lsp ✓ 🚀",
			);
			assert.strictEqual(result.exitCode, 0);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("returns an initialize error as data, skips initialized, and still shuts down", () =>
		Effect.gen(function* () {
			const result = yield* LspProbe.initialize(yield* command("--fail-initialize"));
			assert.strictEqual(result.response.error?.code, -32603);
			assert.strictEqual(result.exitCode, 0);
			const received = result.messages.find((message) => message.method === "fixture/received");
			assert.deepStrictEqual(received?.params, { methods: ["initialize", "shutdown"] });
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("a server that exits before responding fails StreamEnded with its exit code and stderr", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(LspProbe.initialize(yield* command("--exit-early")));
			assert.strictEqual(reasonOf(failure), "StreamEnded");
			assert.include(failure.message, "the id-1 initialize response");
			assert.include(failure.message, "exited with code 3");
			assert.include(failure.message, "fatal: config missing");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("a server that never answers fails TimedOut naming the step, never hangs", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(
				LspProbe.initialize(yield* command("--never-answer"), { timeout: "500 millis" }),
			);
			assert.strictEqual(reasonOf(failure), "TimedOut");
			assert.include(failure.message, "the id-1 initialize response");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("a server that ignores exit and waits for stdin EOF fails TimedOut: stdin stays open", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(LspProbe.initialize(yield* command("--ignore-exit"), { timeout: "1 second" }));
			assert.strictEqual(reasonOf(failure), "TimedOut");
			assert.include(failure.message, "exit notification");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.live("a log line on stdout fails InvalidFrame, echoing the line", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(LspProbe.initialize(yield* command("--noise")));
			assert.strictEqual(reasonOf(failure), "InvalidFrame");
			assert.include(failure.message, "server starting");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
