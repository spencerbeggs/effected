import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { LspFrame } from "../src/index.js";
import type { LspTestFailure } from "../src/testing.js";
import { LspProcess } from "../src/testing.js";
import { fakeLspCommand } from "./helpers/fakeLsp.js";

/** Spawn the hand-written fake server with `flags`, for the life of the test's scope. */
const spawn = (...flags: ReadonlyArray<string>) => Effect.flatMap(fakeLspCommand(...flags), LspProcess.spawn);

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { processId: null, rootUri: null, capabilities: {} },
} as const;

/** The rest of a clean lifecycle after `initialize`: `initialized`, `shutdown` (id 2) and `exit`. */
const finish = (server: LspProcess) =>
	Effect.gen(function* () {
		yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
		yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
		yield* server.send({ jsonrpc: "2.0", method: "exit" });
		return yield* server.exitCode;
	});

const reasonOf = (failure: LspTestFailure) => failure.reason;

// Every wait reads real streams and real timers: run under the live clock.
describe("LspProcess", () => {
	it.live("drives a whole lifecycle: readUntilResponse returns what it read past, and the server exits 0", () =>
		Effect.gen(function* () {
			const server = yield* spawn();
			yield* server.send(INITIALIZE);
			const { response, seen } = yield* server.readUntilResponse(1);
			assert.deepStrictEqual(
				seen.map((message) => message.method ?? `response ${String(message.id)}`),
				["window/logMessage", "response 1"],
			);
			assert.strictEqual(seen.at(-1), response);
			assert.strictEqual(
				(response.result as { readonly serverInfo: { readonly name: string } }).serverInfo.name,
				"fake-lsp ✓ 🚀",
			);
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			// The server request and the fixture's report sit before the id-2 response.
			const shutdown = yield* server.readUntilResponse(2);
			assert.deepStrictEqual(
				shutdown.seen.map((message) => message.method ?? `response ${String(message.id)}`),
				["client/registerCapability", "fixture/received", "response 2"],
			);
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			assert.strictEqual(yield* server.exitCode, 0);
			assert.strictEqual(yield* server.stderrFinal, "");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("sendRaw delivers one frame split across writes, mid-character", () =>
		Effect.gen(function* () {
			const server = yield* spawn();
			const frame = LspFrame.encode({ ...INITIALIZE, params: { ...INITIALIZE.params, rootUri: "file:///ü✓🚀" } });
			// Split inside the four-byte emoji, so neither half is valid UTF-8 alone.
			const cut = frame.length - 6;
			yield* server.sendRaw(frame.subarray(0, 10));
			yield* server.sendRaw(frame.subarray(10, cut));
			yield* server.sendRaw(frame.subarray(cut));
			const { response } = yield* server.readUntilResponse(1);
			assert.strictEqual(
				(response.result as { readonly echoed: { readonly rootUri: string } }).echoed.rootUri,
				"file:///ü✓🚀",
			);
			assert.strictEqual(yield* finish(server), 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("nextMessage fails StreamEnded once the server exits, never hangs", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--exit-early");
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(server.nextMessage);
			assert.strictEqual(reasonOf(failure), "StreamEnded");
			assert.include(failure.message, "stdout ended before the expected message");
			assert.strictEqual(yield* server.exitCode, 3);
			assert.include(yield* server.stderrFinal, "fatal: config missing");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("a stream that ends inside a frame fails StreamEnded, naming the truncation", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--truncate");
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(server.nextMessage);
			assert.strictEqual(reasonOf(failure), "StreamEnded");
			assert.include(failure.message, "inside a frame");
			assert.strictEqual(yield* server.exitCode, 4);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("a well-framed body that is not JSON-RPC fails NotJsonRpc", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--not-jsonrpc");
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(server.nextMessage);
			assert.strictEqual(reasonOf(failure), "NotJsonRpc");
			assert.include(failure.message, "[1,2,3]");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("closeStdin delivers every frame already sent, then ends stdin", () =>
		Effect.gen(function* () {
			// --ignore-exit stops only at stdin EOF.
			const server = yield* spawn("--ignore-exit");
			yield* server.send(INITIALIZE);
			yield* server.closeStdin;
			const { response } = yield* server.readUntilResponse(1);
			assert.isUndefined(response.error);
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});

describe("LspProcess.stderrUntil", () => {
	it.live("waits for a report written on a later tick than every response", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--stderr-late");
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			// Control: the report is not there yet when the responses are.
			assert.notInclude(yield* server.stderrSoFar, "late report");
			const text = yield* server.stderrUntil((stderr) => stderr.includes("late report"), { timeout: "5 seconds" });
			assert.include(text, "late report");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails TimedOut when the predicate never holds while the server runs", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--never-answer");
			const failure = yield* Effect.flip(server.stderrUntil(() => false, { timeout: "300 millis" }));
			assert.strictEqual(reasonOf(failure), "TimedOut");
			assert.include(failure.message, "did not match within");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails StreamEnded when stderr ends without the predicate holding, carrying the stderr", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--exit-early");
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(
				server.stderrUntil((stderr) => stderr.includes("never written"), { timeout: "5 seconds" }),
			);
			assert.strictEqual(reasonOf(failure), "StreamEnded");
			assert.include(failure.message, "fatal: config missing");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});

describe("LspProcess.assertOnlyFrames", () => {
	it.live("passes a stdout of nothing but frames and returns every message, the ones already read included", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--split");
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			assert.strictEqual(yield* finish(server), 0);
			const messages = yield* server.assertOnlyFrames;
			assert.deepStrictEqual(
				messages.map((message) => message.method ?? `response ${String(message.id)}`),
				["window/logMessage", "response 1", "client/registerCapability", "fixture/received", "response 2"],
			);
			const raw = yield* server.stdoutFinal;
			assert.strictEqual(new TextDecoder().decode(raw.subarray(0, 16)), "Content-Length: ");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails InvalidFrame on a stray line before the first frame, quoting it", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--noise");
			yield* server.send(INITIALIZE);
			assert.strictEqual(reasonOf(yield* Effect.flip(server.nextMessage)), "InvalidFrame");
			assert.strictEqual(yield* finish(server), 0);
			const failure = yield* Effect.flip(server.assertOnlyFrames);
			assert.strictEqual(reasonOf(failure), "InvalidFrame");
			assert.include(failure.message, "at byte 0");
			assert.include(failure.message, "server starting");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails InvalidFrame on stray bytes between two frames, even though the earlier frames decoded", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--noise-between");
			yield* server.send(INITIALIZE);
			const { response } = yield* server.readUntilResponse(1);
			assert.isUndefined(response.error);
			assert.strictEqual(yield* finish(server), 0);
			const failure = yield* Effect.flip(server.assertOnlyFrames);
			assert.strictEqual(reasonOf(failure), "InvalidFrame");
			assert.include(failure.message, "stray between frames");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails InvalidFrame on stray bytes after the last frame", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--noise-after");
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			yield* server.readUntilResponse(2);
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			assert.strictEqual(yield* server.exitCode, 0);
			const failure = yield* Effect.flip(server.assertOnlyFrames);
			assert.strictEqual(reasonOf(failure), "InvalidFrame");
			assert.include(failure.message, "bye");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("fails NotJsonRpc on a well-framed body that is no JSON-RPC message", () =>
		Effect.gen(function* () {
			const server = yield* spawn("--not-jsonrpc");
			yield* server.send(INITIALIZE);
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			yield* server.exitCode;
			const failure = yield* Effect.flip(server.assertOnlyFrames);
			assert.strictEqual(reasonOf(failure), "NotJsonRpc");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
