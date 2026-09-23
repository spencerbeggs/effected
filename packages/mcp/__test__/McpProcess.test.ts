import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { McpProcess } from "../src/testing.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-server.mjs");
const command = (...flags: ReadonlyArray<string>) =>
	ChildProcess.make(process.execPath, [FAKE, ...flags], { env: { PATH: process.env.PATH ?? "" } });
const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

describe("McpProcess", () => {
	it.live("readUntilResponse reads past an interleaved notification and returns what it saw", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command());
			yield* server.send(INITIALIZE);
			const { response, seen } = yield* server.readUntilResponse(1);
			assert.strictEqual(response.id, 1);
			assert.deepStrictEqual(
				seen.map((message) => message.method ?? `response:${String(message.id)}`),
				["notifications/tools/list_changed", "response:1"],
			);
		}).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a child that exits before responding fails the read instead of hanging", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--exit-early"));
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(server.readUntilResponse(1));
			assert.strictEqual(failure.reason, "StreamEnded");
			assert.strictEqual(yield* server.exitCode, 3);
			assert.strictEqual(yield* server.stderrFinal, "fatal: config missing\n");
		}).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("closeStdin ends the child with exit 0, after which nextLine fails", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command());
			yield* server.handshake();
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			assert.strictEqual((yield* Effect.flip(server.nextLine)).reason, "StreamEnded");
		}).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("closeStdin delivers every frame offered before it (Queue.end, never Queue.shutdown)", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--count-on-end"));
			yield* server.send({ jsonrpc: "2.0", method: "a" });
			yield* server.send({ jsonrpc: "2.0", method: "b" });
			yield* server.send({ jsonrpc: "2.0", method: "c" });
			yield* server.closeStdin;
			const count = JSON.parse(yield* server.nextLine) as { readonly params: { readonly frames: number } };
			assert.strictEqual(count.params.frames, 3);
		}).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a stdout line that is not JSON-RPC fails readUntilResponse with NotJsonRpc", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--noise"));
			yield* server.send(INITIALIZE);
			assert.strictEqual((yield* Effect.flip(server.readUntilResponse(1))).reason, "NotJsonRpc");
		}).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);
});
