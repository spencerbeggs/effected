import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, vi } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, References, Runtime, Sink, Stdio, Stream } from "effect";
import { McpProtocol } from "effect/ai";
import { ChildProcess } from "effect/process";
import { McpStdio } from "../src/index.js";
import { McpProcess } from "../src/testing.js";

/** Run an effect exactly as a platform runMain does — its outer failure report included — and resolve the exit code. */
const runMainFor = (
	effect: Effect.Effect<unknown, unknown>,
	teardown: Runtime.Teardown = McpStdio.teardown,
): Promise<number> =>
	new Promise((resolve) => {
		Runtime.makeRunMain(({ fiber, teardown: finish }) => {
			fiber.addObserver((exit) => finish(exit, resolve));
		})(effect, { teardown });
	});

/** Capture the global console, which is where Effect's default logger writes (ConsoleRef defaults to globalThis.console). */
const captured = async (run: () => Promise<number>) => {
	const out: Array<string> = [];
	const err: Array<string> = [];
	const log = vi.spyOn(console, "log").mockImplementation((...parts: ReadonlyArray<unknown>) => {
		out.push(parts.map(String).join(" "));
	});
	const error = vi.spyOn(console, "error").mockImplementation((...parts: ReadonlyArray<unknown>) => {
		err.push(parts.map(String).join(" "));
	});
	try {
		const code = await run();
		return { code, out, err };
	} finally {
		log.mockRestore();
		error.mockRestore();
	}
};

/** The one-line `main.ts` over the fixture server, run by Node's own type stripping through the fixture resolve hook. */
const STDIO_MAIN = ChildProcess.make(
	process.execPath,
	[
		"--import",
		pathToFileURL(join(import.meta.dirname, "fixtures", "ts-resolve.mjs")).href,
		join(import.meta.dirname, "fixtures", "stdio-main.ts"),
	],
	{ env: { PATH: process.env.PATH ?? "" } },
);

const INITIALIZE = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
});
const PARSE_ERROR = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } } as const;
const INVALID_REQUEST = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } } as const;
const toolsList = (id: number) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" });

class Seen extends Context.Service<Seen, Stdio.Stdio>()("test/Seen") {}

const idOf = (frame: unknown): unknown => (frame as { readonly id?: unknown }).id;

class ConfigMissing extends Error {
	readonly [Runtime.errorExitCode] = 3;
}

describe("McpStdio.protocols", () => {
	it("is stateless first, then the two newest stateful revisions", () => {
		assert.deepStrictEqual(
			McpStdio.protocols.map((protocol) => protocol.protocolVersion),
			["2026-07-28", "2025-11-25", "2025-06-18"],
		);
	});
});

describe("McpStdio.layer", () => {
	it.effect("outputs LogToStderr beside the server, so layers composed with it inherit stderr logging", () =>
		Effect.gen(function* () {
			const context = yield* Layer.build(
				McpStdio.layer({ name: "t", version: "0.0.0" }).pipe(Layer.provide(Stdio.layerTest({ stdin: Stream.never }))),
			);
			assert.isTrue(Context.get(context, References.LogToStderr));
		}),
	);

	it.effect("a layer composed with it sees the ambient Stdio, never the server's guarded one", () =>
		Effect.gen(function* () {
			const ambient = Stdio.make({
				args: Effect.succeed([]),
				stdin: Stream.never,
				stdout: () => Sink.drain,
				stderr: () => Sink.drain,
			});
			const seen = yield* Layer.build(
				Layer.effect(Seen, Stdio.Stdio).pipe(
					Layer.provideMerge(McpStdio.layer({ name: "t", version: "0.0.0" })),
					Layer.provide(Layer.succeed(Stdio.Stdio, ambient)),
				),
			);
			assert.strictEqual(Context.get(seen, Seen), ambient);
		}),
	);

	it.effect("a bad protocols list is the implementer's defect, not a typed failure", () =>
		Effect.gen(function* () {
			const exit = yield* Layer.build(
				McpStdio.layer({
					name: "t",
					version: "0.0.0",
					protocols: [McpProtocol.v2026_07_28, McpProtocol.v2026_07_28],
				}).pipe(Layer.provide(Stdio.layerTest({ stdin: Stream.never }))),
			).pipe(Effect.exit);
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		}),
	);
});

describe("McpStdio.teardown", () => {
	it("maps success and an interrupt-only exit to 0, and defers anything else", () => {
		const codes: Array<number> = [];
		const record = (code: number) => {
			codes.push(code);
		};
		McpStdio.teardown(Exit.succeed(1), record);
		McpStdio.teardown(Exit.interrupt(1), record);
		McpStdio.teardown(Exit.fail("boom"), record);
		McpStdio.teardown(Exit.fail(new ConfigMissing("x")), record);
		assert.deepStrictEqual(codes, [0, 0, 1, 3]);
	});
});

describe("McpStdio.launch under runMain semantics", () => {
	it("stdin EOF ends the server with exit 0", async () => {
		const server = McpStdio.layer({ name: "t", version: "0.0.0" }).pipe(Layer.provide(Stdio.layerTest({})));
		assert.strictEqual(await runMainFor(McpStdio.launch(server)), 0);
	});

	it("control: the default teardown turns that same EOF into 130", async () => {
		const server = McpStdio.layer({ name: "t", version: "0.0.0" }).pipe(Layer.provide(Stdio.layerTest({})));
		assert.strictEqual(await runMainFor(McpStdio.launch(server), Runtime.defaultTeardown), 130);
	});

	it("a layer-build failure is reported once, on stderr, with its own exit code — never on stdout", async () => {
		const broken = Layer.effectDiscard(Effect.fail(new ConfigMissing("config missing")));
		const { code, out, err } = await captured(() => runMainFor(McpStdio.launch(broken)));
		assert.strictEqual(code, 3);
		assert.deepStrictEqual(out, []);
		assert.strictEqual(err.filter((line) => line.includes("config missing")).length, 1);
	});

	it("control: providing LogToStderr on the launched effect alone still leaks runMain's report to stdout", async () => {
		const naive = Layer.launch(Layer.effectDiscard(Effect.fail(new Error("config missing")))).pipe(
			Effect.provideService(References.LogToStderr, true),
		);
		const { out } = await captured(() => runMainFor(naive, Runtime.defaultTeardown));
		assert.isTrue(out.some((line) => line.includes("config missing")));
	});
});

describe("McpStdio.layer over a real process's stdio", () => {
	it.live("answers an unparseable frame with a -32700 parse error, ignores a blank line, and keeps serving", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(STDIO_MAIN);
			// A blank line, the bad frame and a good one in one write, then more in later writes.
			// A blank line is not a frame: it gets no answer.
			yield* server.sendRaw(`\n{not json\n${INITIALIZE}\n`);
			const first = yield* server.readUntilResponse(1);
			assert.deepStrictEqual(
				first.seen.filter((frame) => idOf(frame) === null),
				[PARSE_ERROR],
			);
			yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
			// A U+FEFF opening a later line is not stripped by core's decoder, so it is not JSON there either.
			yield* server.sendRaw(`\ufeff${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" })}\n`);
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
			const second = yield* server.readUntilResponse(2);
			assert.deepStrictEqual(
				second.seen.filter((frame) => idOf(frame) !== 2),
				[PARSE_ERROR],
			);
			assert.isArray((second.response.result as { readonly tools: unknown }).tools);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("closing stdin with a request in flight still delivers its response, then exits 0", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(STDIO_MAIN);
			yield* server.handshake();
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "slow", arguments: {} } });
			yield* server.closeStdin;
			const { response } = yield* server.readUntilResponse(2);
			assert.deepStrictEqual((response.result as { readonly structuredContent?: unknown }).structuredContent, {
				ok: true,
			});
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.timeout("5 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("decodes a UTF-8 character split between two writes", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(STDIO_MAIN);
			yield* server.handshake();
			const frame = new TextEncoder().encode(
				`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "é" } } })}\n`,
			);
			const cut = frame.indexOf(0xc3) + 1; // between the two bytes of "é"
			yield* server.sendRaw(frame.subarray(0, cut));
			// Real time, so the two writes reach the server as two chunks.
			yield* Effect.sleep("100 millis");
			yield* server.sendRaw(frame.subarray(cut));
			const { response } = yield* server.readUntilResponse(2);
			assert.deepStrictEqual((response.result as { readonly structuredContent: unknown }).structuredContent, {
				text: "é",
			});
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live(
		"answers JSON that is not a JSON-RPC message with -32600, answers the request co-batched after it, and keeps serving",
		() =>
			Effect.gen(function* () {
				const server = yield* McpProcess.spawn(STDIO_MAIN);
				yield* server.handshake();
				// Core skips these without a reply; JSON-RPC 2.0 requires an Invalid Request for each.
				yield* server.sendRaw(`null\n${toolsList(2)}\n`);
				const first = yield* server.readUntilResponse(2);
				assert.deepStrictEqual(
					first.seen.filter((frame) => idOf(frame) === null),
					[INVALID_REQUEST],
				);
				// Scalars and an object that is neither a request nor a response get one too.
				yield* server.sendRaw(`{"method":1}\n7\n{}\n${toolsList(3)}\n`);
				const second = yield* server.readUntilResponse(3);
				assert.deepStrictEqual(
					second.seen.filter((frame) => idOf(frame) === null),
					[INVALID_REQUEST, INVALID_REQUEST, INVALID_REQUEST],
				);
				yield* server.send({ jsonrpc: "2.0", id: 4, method: "tools/list" });
				const { response } = yield* server.readUntilResponse(4);
				assert.isArray((response.result as { readonly tools: unknown }).tools);
				assert.notInclude(yield* server.stderrSoFar, "ERROR");
			}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("keeps serving after an @effect/rpc/Eof notification, and answers an @effect/rpc/ request -32601", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(STDIO_MAIN);
			yield* server.handshake();
			// Unguarded, core reads this as its own end-of-input control message and stops serving
			// (Effect-TS/effect#8499): id 2 below would never get a reply.
			yield* server.sendRaw(`{"jsonrpc":"2.0","method":"@effect/rpc/Eof"}\n${toolsList(2)}\n`);
			const first = yield* server.readUntilResponse(2);
			assert.deepStrictEqual(
				first.seen.filter((frame) => idOf(frame) !== 2),
				[],
			);
			assert.isArray((first.response.result as { readonly tools: unknown }).tools);
			yield* server.send({ jsonrpc: "2.0", id: 3, method: "@effect/rpc/Eof" });
			const second = yield* server.readUntilResponse(3);
			assert.deepStrictEqual(second.response, {
				jsonrpc: "2.0",
				id: 3,
				error: { code: -32601, message: "Method not found" },
			});
			yield* server.send({ jsonrpc: "2.0", id: 4, method: "ping" });
			const { response } = yield* server.readUntilResponse(4);
			assert.deepStrictEqual(response.result, {});
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("answers a bare null and keeps the partial frame written after it", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(STDIO_MAIN);
			yield* server.handshake();
			yield* server.sendRaw('null\n{"jsonrpc":"2.0","id":2,"meth');
			// Real time, so the two writes reach the server as two chunks.
			yield* Effect.sleep("100 millis");
			yield* server.sendRaw('od":"tools/list"}\n');
			const { response, seen } = yield* server.readUntilResponse(2);
			assert.deepStrictEqual(
				seen.filter((frame) => idOf(frame) === null),
				[INVALID_REQUEST],
			);
			assert.isArray((response.result as { readonly tools: unknown }).tools);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);
});
