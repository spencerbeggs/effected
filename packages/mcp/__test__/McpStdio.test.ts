import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, vi } from "@effect/vitest";
import type { Scope } from "effect";
import { Cause, Context, Effect, Exit, Layer, Queue, References, Runtime, Stdio, Stream } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { McpStdio } from "../src/index.js";

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
const PARSE_ERROR = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };

/** A real server process driven with raw stdin writes, which `McpProcess.send` cannot make: it always writes valid JSON. */
const spawnRaw: Effect.Effect<
	{
		readonly write: (text: string) => Effect.Effect<void>;
		readonly readUntilId: (id: number) => Effect.Effect<ReadonlyArray<unknown>, Cause.Done>;
	},
	unknown,
	ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const handle = yield* spawner.spawn(STDIO_MAIN);
	const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
	yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(Effect.forkScoped);
	const lines = yield* Queue.unbounded<string, Cause.Done>();
	yield* Stream.splitLines(Stream.decodeText(handle.stdout)).pipe(
		Stream.runForEach((line) => Queue.offer(lines, line)),
		Effect.ensuring(Queue.end(lines)),
		Effect.forkScoped,
	);
	const encoder = new TextEncoder();
	return {
		write: (text: string) => Effect.asVoid(Queue.offer(stdin, encoder.encode(text))),
		readUntilId: (id: number) =>
			Effect.gen(function* () {
				const seen: Array<unknown> = [];
				while (true) {
					const frame = JSON.parse(yield* Queue.take(lines)) as { readonly id?: unknown };
					seen.push(frame);
					if (frame.id === id) return seen;
				}
			}),
	};
});

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
			const server = yield* spawnRaw;
			// A blank line, the bad frame and a good one in one write, then another request in a later write.
			// A blank line is not a frame: it gets no answer, and it too stopped the server before the guard.
			yield* server.write(`\n{not json\n${INITIALIZE}\n`);
			const first = yield* server.readUntilId(1);
			assert.deepStrictEqual(
				first.filter((frame) => (frame as { readonly id?: unknown }).id === null),
				[PARSE_ERROR],
			);
			yield* server.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
			yield* server.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
			const second = yield* server.readUntilId(2);
			assert.isArray((second.at(-1) as { readonly result: { readonly tools: unknown } }).result.tools);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);
});
