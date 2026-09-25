import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { McpGuardHost, McpGuardRunOptions } from "../src/guard.js";
import { McpGuard } from "../src/guard.js";
import { McpProcess } from "../src/testing.js";

// Compile-time: Node's own `process` and `NodeRuntime.runMain` satisfy the guard's structural types.
export const nodeFits = (): McpGuardRunOptions<never, never> => ({
	label: "types",
	host: process,
	load: async () => ({ layer: Layer.empty, runMain: NodeRuntime.runMain }),
});

class ExitCalled extends Error {
	constructor(readonly code: number | undefined) {
		super(`exit(${code})`);
	}
}

/** A host double: listeners are called by the test, exit throws so nothing after it runs. */
const fakeHost = () => {
	const listeners: Record<string, (...args: ReadonlyArray<unknown>) => void> = {};
	const stderr: Array<string> = [];
	const exits: Array<number | undefined> = [];
	const host: McpGuardHost = {
		on: (event: string, listener: (...args: ReadonlyArray<unknown>) => void) => {
			listeners[event] = listener;
		},
		stderr: { write: (chunk: string) => stderr.push(chunk) },
		exit: (code?: number): never => {
			exits.push(code);
			throw new ExitCalled(code);
		},
	} as McpGuardHost;
	const fire = (event: "uncaughtException" | "unhandledRejection", value: unknown) => {
		try {
			listeners[event]?.(value, "uncaughtException");
		} catch (error) {
			if (!(error instanceof ExitCalled)) throw error;
		}
	};
	return { host, stderr, exits, fire, listeners };
};

/** A runMain double that forks the launch and keeps the fiber for interruption. */
const forkingRunMain = () => {
	const fibers: Array<Fiber.Fiber<never, Error>> = [];
	return {
		fibers,
		runMain: (effect: Effect.Effect<never, Error>) => {
			fibers.push(Effect.runFork(effect));
		},
	};
};

const stop = (fibers: ReadonlyArray<Fiber.Fiber<never, Error>>) =>
	Effect.runPromise(Effect.forEach(fibers, Fiber.interrupt, { discard: true }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("McpGuard.run with a host double", () => {
	it("installs both listeners before load runs", async () => {
		const { host, listeners } = fakeHost();
		let seen: ReadonlyArray<string> = [];
		const { runMain, fibers } = forkingRunMain();
		await McpGuard.run({
			label: "t",
			host,
			load: async () => {
				seen = Object.keys(listeners);
				return { layer: Layer.empty, runMain };
			},
		});
		assert.sameMembers([...seen], ["uncaughtException", "unhandledRejection"]);
		await stop(fibers);
	});

	it("default policy: both exit 1, after connect too, and report on stderr", async () => {
		const { host, stderr, exits, fire } = fakeHost();
		const { runMain } = forkingRunMain();
		await McpGuard.run({ label: "srv", host, load: async () => ({ layer: Layer.empty, runMain }) });
		await settle();
		fire("uncaughtException", new Error("boom"));
		fire("unhandledRejection", new Error("nope"));
		assert.deepStrictEqual(exits, [1, 1]);
		assert.match(stderr[0] ?? "", /^srv: uncaughtException \(uncaughtException\): Error: boom/);
		assert.match(stderr[1] ?? "", /^srv: unhandledRejection: Error: nope/);
	});

	it("exitBeforeConnect: exits while loading, logs and keeps going once serving", async () => {
		const { host, stderr, exits, fire } = fakeHost();
		const { runMain } = forkingRunMain();
		await McpGuard.run({
			label: "srv",
			host,
			policy: { onUncaught: "exitBeforeConnect", onRejection: "exitBeforeConnect" },
			load: async () => {
				fire("uncaughtException", new Error("early"));
				return { layer: Layer.empty, runMain };
			},
		});
		assert.deepStrictEqual(exits, [1]);
		await settle();
		fire("uncaughtException", new Error("late"));
		fire("unhandledRejection", new Error("late rejection"));
		assert.deepStrictEqual(exits, [1], "no exit once the server is serving");
		assert.strictEqual(stderr.length, 3);
	});

	it("a server that never finishes building never counts as connected (negative control)", async () => {
		const { host, exits, fire } = fakeHost();
		const { runMain } = forkingRunMain();
		await McpGuard.run({
			label: "srv",
			host,
			policy: { onUncaught: "exitBeforeConnect" },
			load: async () => ({ layer: Layer.effectDiscard(Effect.never), runMain }),
		});
		await settle();
		fire("uncaughtException", new Error("still building"));
		assert.deepStrictEqual(exits, [1]);
	});

	it("onRejection log never exits", async () => {
		const { host, exits, fire } = fakeHost();
		const { runMain } = forkingRunMain();
		await McpGuard.run({
			label: "srv",
			host,
			policy: { onUncaught: "exit", onRejection: "log" },
			load: async () => ({ layer: Layer.empty, runMain }),
		});
		fire("unhandledRejection", "a string reason");
		assert.deepStrictEqual(exits, []);
	});

	it("a load rejection is reported as startup failed and exits 1, whatever the policy", async () => {
		const { host, stderr, exits } = fakeHost();
		await McpGuard.run({
			label: "srv",
			host,
			policy: { onUncaught: "exitBeforeConnect", onRejection: "log" },
			load: async () => {
				throw new Error("cannot load");
			},
		}).catch((error: unknown) => {
			if (!(error instanceof ExitCalled)) throw error;
		});
		assert.deepStrictEqual(exits, [1]);
		assert.match(stderr[0] ?? "", /^srv: startup failed: Error: cannot load/);
	});

	it("an injectCrash with an unknown kind or phase raises nothing and still loads", async () => {
		const { host, exits, stderr } = fakeHost();
		const { runMain, fibers } = forkingRunMain();
		let loads = 0;
		for (const injectCrash of [
			{ at: "load", kind: "bogus" },
			{ at: "later", kind: "uncaughtException" },
		] as unknown as ReadonlyArray<McpGuardRunOptions<never, never>["injectCrash"]>) {
			await McpGuard.run({
				label: "srv",
				host,
				injectCrash,
				load: async () => {
					loads += 1;
					return { layer: Layer.empty, runMain };
				},
			});
		}
		await settle();
		assert.strictEqual(loads, 2);
		assert.deepStrictEqual(exits, []);
		assert.deepStrictEqual(stderr, []);
		await stop(fibers);
	});

	it("uses the server's formatter once loaded, and falls back if it throws", async () => {
		const { host, stderr, fire } = fakeHost();
		const { runMain } = forkingRunMain();
		let throwing = false;
		await McpGuard.run({
			label: "srv",
			host,
			policy: { onUncaught: "exit", onRejection: "log" },
			load: async () => ({
				layer: Layer.empty,
				runMain,
				format: (error) => {
					if (throwing) throw new Error("formatter broke");
					return `fmt:${String(error)}`;
				},
			}),
		});
		fire("unhandledRejection", "x");
		throwing = true;
		fire("unhandledRejection", "y");
		assert.deepStrictEqual(stderr, ["srv: unhandledRejection: fmt:x\n", "srv: unhandledRejection: y\n"]);
	});
});

const guardMain = (...flags: ReadonlyArray<string>) =>
	ChildProcess.make(
		process.execPath,
		[
			"--import",
			pathToFileURL(join(import.meta.dirname, "fixtures", "ts-resolve.mjs")).href,
			join(import.meta.dirname, "fixtures", "guard-main.ts"),
			...flags,
		],
		{ env: { PATH: process.env.PATH ?? "" } },
	);

/** Wait until the child's stderr contains `text`. */
const stderrShows = (server: McpProcess, text: string) =>
	Effect.gen(function* () {
		while (!(yield* server.stderrSoFar).includes(text)) yield* Effect.sleep("20 millis");
	});

describe("McpGuard.run in a real process", () => {
	it.live("exitBeforeConnect: an uncaught exception after connect is logged and the server keeps serving", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(
				guardMain("--policy=exitBeforeConnect", "--inject=connected:uncaughtException"),
			);
			yield* stderrShows(server, "uncaughtException");
			const response = yield* server.handshake();
			assert.isDefined(response.result);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			assert.include(
				yield* server.stderrFinal,
				"guard-fixture: uncaughtException (uncaughtException): formatted([injected] uncaughtException)",
			);
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("exit: the same injected exception ends the process with 1 (control)", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--policy=exit", "--inject=connected:uncaughtException"));
			assert.strictEqual(yield* server.exitCode, 1);
			assert.include(yield* server.stderrFinal, "guard-fixture: uncaughtException");
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("onRejection log: an injected rejection is logged and the server keeps serving", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--rejection=log", "--inject=connected:unhandledRejection"));
			yield* stderrShows(server, "unhandledRejection");
			assert.isDefined((yield* server.handshake()).result);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("onRejection default: an injected rejection exits 1", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--inject=connected:unhandledRejection"));
			assert.strictEqual(yield* server.exitCode, 1);
			assert.include(
				yield* server.stderrFinal,
				"guard-fixture: unhandledRejection: formatted([injected] unhandledRejection)",
			);
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("exitBeforeConnect: an injected rejection once connected is logged and the server keeps serving", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(
				guardMain("--rejection=exitBeforeConnect", "--inject=connected:unhandledRejection"),
			);
			yield* stderrShows(server, "unhandledRejection");
			assert.isDefined((yield* server.handshake()).result);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	// injectCrash at "load": raised before load() is called, so the pre-connect half of every policy applies.
	const atLoad = [
		{ kind: "uncaughtException", flags: ["--policy=exitBeforeConnect"] },
		{ kind: "uncaughtException", flags: ["--policy=exit"] },
		{ kind: "unhandledRejection", flags: ["--rejection=exitBeforeConnect"] },
		{ kind: "unhandledRejection", flags: ["--rejection=exit"] },
	] as const;
	for (const { kind, flags } of atLoad) {
		it.live(`${flags.join(" ")}: an injected ${kind} at load exits 1 before load() runs`, () =>
			Effect.gen(function* () {
				const server = yield* McpProcess.spawn(guardMain(...flags, `--inject=load:${kind}`, "--trace-load"));
				assert.strictEqual(yield* server.exitCode, 1);
				const stderr = yield* server.stderrFinal;
				// Reported by the guard's own formatter: no server `format` is loaded yet.
				assert.include(stderr, `guard-fixture: ${kind}`);
				assert.include(stderr, `Error: [injected] ${kind}`);
				assert.notInclude(stderr, "formatted(");
				assert.notInclude(stderr, "load ran");
			}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
		);
	}

	it.live("onRejection log: an injected rejection at load is logged, then the server loads and serves", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(
				guardMain("--policy=exitBeforeConnect", "--rejection=log", "--inject=load:unhandledRejection", "--trace-load"),
			);
			yield* stderrShows(server, "load ran");
			assert.isDefined((yield* server.handshake()).result);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			const stderr = yield* server.stderrFinal;
			const report = stderr.indexOf("guard-fixture: unhandledRejection: Error: [injected] unhandledRejection");
			assert.isAtLeast(report, 0);
			assert.isBelow(report, stderr.indexOf("guard-fixture: load ran"), "the crash is handled before load() is called");
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("exitBeforeConnect: a crash while loading exits 1", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--policy=exitBeforeConnect", "--crash-in-load"));
			assert.strictEqual(yield* server.exitCode, 1);
			assert.include(yield* server.stderrFinal, "crashed while loading");
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a failing load is startup failed, exit 1, even under a log-only policy", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--policy=exitBeforeConnect", "--rejection=log", "--fail-load"));
			assert.strictEqual(yield* server.exitCode, 1);
			assert.include(yield* server.stderrFinal, "guard-fixture: startup failed: Error: no server here");
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("with no crash injected, the guarded server serves and exits 0 on stdin close", () =>
		Effect.gen(function* () {
			const server = yield* McpProcess.spawn(guardMain("--policy=exitBeforeConnect"));
			assert.isDefined((yield* server.handshake()).result);
			yield* server.closeStdin;
			assert.strictEqual(yield* server.exitCode, 0);
			assert.strictEqual(yield* server.stderrFinal, "");
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
	);
});
