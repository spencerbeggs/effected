import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, vi } from "@effect/vitest";
import { Config, Context, Effect, Exit, Layer, Option, References, Runtime } from "effect";
import { ChildProcess } from "effect/process";
import type { LspSessionEnd } from "../src/index.js";
import { LspStdio } from "../src/index.js";
import { LspProcess } from "../src/testing.js";

/** A host that records every exit instead of ending the test process. */
const recordingHost = () => {
	const exits: Array<number> = [];
	return { exits, host: { exit: (code: number) => void exits.push(code) } };
};

/** Run an effect exactly as a platform runMain does — its outer failure report included — and resolve the exit code. */
const runMainFor = (effect: Effect.Effect<unknown, unknown>, teardown: Runtime.Teardown): Promise<number> =>
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

class Home extends Context.Service<Home, string>()("test/Home") {}
/** A layer that fails at build, as a platform layer does without `HOME`. */
const BrokenHome = Layer.effect(Home, Effect.fail(new ConfigMissing("HOME is not set")));
const ended = (end: LspSessionEnd) => Effect.succeed(end);

describe("LspStdio.exitCode", () => {
	it("is 1 only for exit without a prior shutdown", () => {
		assert.strictEqual(LspStdio.exitCode({ reason: "exit", shutdownReceived: true }), 0);
		assert.strictEqual(LspStdio.exitCode({ reason: "exit", shutdownReceived: false }), 1);
		assert.strictEqual(LspStdio.exitCode({ reason: "closed", shutdownReceived: true }), 0);
		assert.strictEqual(LspStdio.exitCode({ reason: "closed", shutdownReceived: false }), 0);
	});
});

describe("LspStdio.teardown", () => {
	it("hands on a numeric success, maps interrupts to 0, keeps a failure's code, and always ends through the host", () => {
		const { exits, host } = recordingHost();
		const codes: Array<number> = [];
		const record = (code: number) => void codes.push(code);
		const teardown = LspStdio.teardown(host);
		teardown(Exit.succeed(1), record);
		teardown(Exit.succeed(0), record);
		teardown(Exit.succeed("not a code"), record);
		teardown(Exit.interrupt(1), record);
		teardown(Exit.fail("boom"), record);
		teardown(Exit.fail(new ConfigMissing("x")), record);
		assert.deepStrictEqual(codes, [1, 0, 0, 0, 1, 3]);
		assert.deepStrictEqual(exits, codes);
	});
});

describe("LspStdio.launch under runMain semantics", () => {
	it("maps the session end to the specification's exit code", async () => {
		const teardown = LspStdio.teardown(recordingHost().host);
		assert.strictEqual(
			await runMainFor(LspStdio.launch(ended({ reason: "exit", shutdownReceived: true })), teardown),
			0,
		);
		assert.strictEqual(
			await runMainFor(LspStdio.launch(ended({ reason: "exit", shutdownReceived: false })), teardown),
			1,
		);
		assert.strictEqual(
			await runMainFor(LspStdio.launch(ended({ reason: "closed", shutdownReceived: false })), teardown),
			0,
		);
	});

	it("an interrupted session exits 0", async () => {
		assert.strictEqual(await runMainFor(LspStdio.launch(Effect.interrupt), LspStdio.teardown(recordingHost().host)), 0);
	});

	it("reports a layer that fails to build on stderr only, keeping its exit code", async () => {
		const program = Effect.gen(function* () {
			yield* Home;
			return { reason: "exit", shutdownReceived: true } as const;
		}).pipe(Effect.provide(BrokenHome));
		const { code, out, err } = await captured(() =>
			runMainFor(LspStdio.launch(program), LspStdio.teardown(recordingHost().host)),
		);
		assert.strictEqual(code, 3);
		assert.deepStrictEqual(out, [], "nothing reached stdout, the LSP wire");
		assert.strictEqual(err.filter((line) => line.includes("HOME is not set")).length, 1, "reported exactly once");
	});

	it("routes the program's own log lines to stderr", async () => {
		const program = Effect.log("serving").pipe(Effect.as({ reason: "closed", shutdownReceived: false } as const));
		const { out, err } = await captured(() =>
			runMainFor(LspStdio.launch(program), LspStdio.teardown(recordingHost().host)),
		);
		assert.deepStrictEqual(out, []);
		assert.isTrue(err.some((line) => line.includes("serving")));
	});

	it("control: providing LogToStderr inside the program alone still leaks runMain's report to stdout", async () => {
		const naive = Effect.gen(function* () {
			yield* Home;
			return 0;
		}).pipe(Effect.provide(BrokenHome), Effect.provideService(References.LogToStderr, true));
		const { code, out } = await captured(() => runMainFor(naive, Runtime.defaultTeardown));
		assert.strictEqual(code, 3);
		assert.isTrue(out.some((line) => line.includes("HOME is not set")));
	});
});

/** The fixture `main.ts` over the real process stdio, run by Node's own type stripping through the resolve hook. */
const launchFixture = (env: Readonly<Record<string, string>>, ...flags: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const path = yield* Config.String("PATH").pipe(Config.withDefault(""));
		return yield* LspProcess.spawn(
			ChildProcess.make(
				process.execPath,
				[
					"--import",
					pathToFileURL(join(import.meta.dirname, "fixtures", "ts-resolve.mjs")).href,
					join(import.meta.dirname, "fixtures", "lsp-main.ts"),
					...flags,
				],
				{ env: { PATH: path, ...env } },
			),
		);
	});

const HOME = { LSP_FIXTURE_HOME: "/fixture/home" };
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as const;

describe("LspStdio in a real process", () => {
	it.live("a launch whose layer cannot build exits 1, the report on stderr and stdout empty", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture({});
			assert.strictEqual(yield* server.exitCode, 1);
			assert.strictEqual((yield* server.stdoutFinal).length, 0, "nothing reached stdout, the LSP wire");
			assert.include(yield* server.stderrFinal, "LSP_FIXTURE_HOME");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("a defect after boot exits 1, reported on stderr, with stdout clean", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture(HOME, "--die");
			assert.strictEqual(yield* server.exitCode, 1);
			assert.deepStrictEqual(yield* server.assertOnlyFrames, []);
			assert.include(yield* server.stderrFinal, "fixture defect after boot");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("shutdown then exit ends the process with 0 while stdin is still open; logs go to stderr", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture(HOME);
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			yield* server.readUntilResponse(2);
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			const code = yield* server.exitCode.pipe(Effect.timeoutOption("5 seconds"));
			assert.deepStrictEqual(code, Option.some(0), "exited on `exit` alone, stdin never closed");
			assert.lengthOf(yield* server.assertOnlyFrames, 2);
			assert.include(yield* server.stderrFinal, "fixture serving from /fixture/home");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("exit without a prior shutdown exits 1", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture(HOME);
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			assert.strictEqual(yield* server.exitCode, 1);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("stdin closing without exit is a client disconnect: 0", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture(HOME);
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("control: without the host exit, the same server sits after exit until stdin closes", () =>
		Effect.gen(function* () {
			const server = yield* launchFixture(HOME, "--no-host-exit");
			yield* server.send(INITIALIZE);
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			yield* server.readUntilResponse(2);
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			const early = yield* server.exitCode.pipe(Effect.timeoutOption("1500 millis"));
			assert.isTrue(Option.isNone(early), "the event loop did not drain with stdin open");
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
