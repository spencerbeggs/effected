import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, PlatformError, Schedule, Sink, Stream } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
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
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a child that exits before responding fails the read instead of hanging", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--exit-early"));
			yield* server.send(INITIALIZE);
			const failure = yield* Effect.flip(server.readUntilResponse(1));
			assert.strictEqual(failure.reason, "StreamEnded");
			assert.strictEqual(yield* server.exitCode, 3);
			assert.strictEqual(yield* server.stderrFinal, "fatal: config missing\n");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("closeStdin ends the child with exit 0, after which nextLine fails", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command());
			yield* server.handshake();
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			assert.strictEqual((yield* Effect.flip(server.nextLine)).reason, "StreamEnded");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
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
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a stdout line that is not JSON-RPC fails readUntilResponse with NotJsonRpc", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--noise"));
			yield* server.send(INITIALIZE);
			assert.strictEqual((yield* Effect.flip(server.readUntilResponse(1))).reason, "NotJsonRpc");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);
	it.live("handshake sends notifications/initialized after the initialize response", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--count-on-end"));
			const response = yield* server.handshake();
			assert.strictEqual(response.id, 1);
			yield* server.closeStdin;
			const count = JSON.parse(yield* server.nextLine) as {
				readonly params: { readonly methods: ReadonlyArray<string> };
			};
			assert.deepStrictEqual(count.params.methods, ["initialize", "notifications/initialized"]);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("handshake speaks server/discover on a stateless revision and sends nothing after it", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--count-on-end"));
			const response = yield* server.handshake(McpProtocol.v2026_07_28);
			assert.deepStrictEqual((response.result as { supportedVersions: ReadonlyArray<string> }).supportedVersions, [
				"2026-07-28",
			]);
			yield* server.closeStdin;
			const count = JSON.parse(yield* server.nextLine) as {
				readonly params: { readonly methods: ReadonlyArray<string> };
			};
			assert.deepStrictEqual(count.params.methods, ["server/discover"]);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("stderrSoFar reads stderr while the child is still running", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(command("--stderr-on-start"));
			const sofar = yield* Effect.repeat(server.stderrSoFar, {
				schedule: Schedule.spaced("10 millis"),
				until: (text) => text.length > 0,
			});
			assert.strictEqual(sofar, "booting\n");
			assert.strictEqual((yield* server.handshake()).id, 1);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			assert.strictEqual(yield* server.stderrFinal, "booting\n");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a stdin pump failure is named in the StreamEnded message", () =>
		Effect.gen(function* () {
			// A spawner double: real Node writes to a dead child's stdin do not
			// fail deterministically, so the pump failure is injected here.
			const epipe = PlatformError.systemError({
				_tag: "Unknown",
				module: "ChildProcess",
				method: "stdin",
				description: "EPIPE",
			});
			const spawner = ChildProcessSpawner.make(() =>
				Effect.succeed(
					ChildProcessSpawner.makeHandle({
						pid: ChildProcessSpawner.ProcessId(1),
						exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						stdin: Sink.fail(epipe),
						// stdout ends only after the pump has already failed.
						stdout: Stream.fromEffect(Effect.sleep("100 millis")).pipe(Stream.drain),
						stderr: Stream.empty,
						all: Stream.empty,
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						unref: Effect.succeed(Effect.void),
					}),
				),
			);
			const server = yield* McpProcess.spawn(command()).pipe(
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
			);
			yield* server.send({ jsonrpc: "2.0", method: "a" });
			const failure = yield* Effect.flip(server.nextLine);
			assert.strictEqual(failure.reason, "StreamEnded");
			assert.include(failure.message, "stdin pump failed");
			assert.include(failure.message, "EPIPE");
		}).pipe(Effect.timeout("3 seconds")),
	);
});
