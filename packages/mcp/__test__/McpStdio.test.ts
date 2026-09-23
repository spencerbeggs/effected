import { assert, describe, it, vi } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, References, Runtime, Stdio, Stream } from "effect";
import { McpProtocol } from "effect/unstable/ai";
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
