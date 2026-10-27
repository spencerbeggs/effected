import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { ProcessLiveness, RunOnce } from "../src/RunOnce.js";

const DIR = "/locks";
const LOCK = `${DIR}/k.lock`;
const DONE = `${DIR}/k.done`;
const OPTIONS = { key: "k", dir: DIR } as const;

const liveness = (isAlive: (pid: number) => boolean = () => true) =>
	ProcessLiveness.layerFrom({ pid: 7, host: "here", isAlive });

const platform = (isAlive?: (pid: number) => boolean) => Layer.mergeAll(MemoryFileSystem.layer, liveness(isAlive));

const exists = (path: string) => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(path));
const readJson = (path: string) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
		Effect.map((text) => JSON.parse(text) as Record<string, unknown>),
	);

describe("RunOnce.run", () => {
	it.effect("runs uncontended work, writes a nonce-bearing done marker and releases", () =>
		Effect.gen(function* () {
			const outcome = yield* RunOnce.run(OPTIONS, Effect.succeed("built"));
			assert.deepStrictEqual(outcome, { _tag: "Ran", value: "built" });
			assert.isFalse(yield* exists(LOCK));
			const marker = yield* readJson(DONE);
			assert.isString(marker.nonce);
			assert.match(String(marker.nonce), /^[0-9a-f]{32}$/);
		}).pipe(Effect.provide(platform())),
	);

	it.effect("a concurrent waiter observes the owner, polls on the Clock, and trusts it when it finishes", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const gate = yield* Deferred.make<void>();
			let runs = 0;
			const work = Effect.gen(function* () {
				runs++;
				yield* Deferred.succeed(started, undefined);
				yield* Deferred.await(gate);
				return "a";
			});
			const owner = yield* RunOnce.run(OPTIONS, work).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			const waiter = yield* RunOnce.run(OPTIONS, work).pipe(Effect.forkChild);
			yield* TestClock.adjust("600 millis"); // three polls against the held lock
			assert.strictEqual(runs, 1);
			yield* Deferred.succeed(gate, undefined);
			assert.deepStrictEqual(yield* Fiber.join(owner), { _tag: "Ran", value: "a" });
			yield* TestClock.adjust("200 millis");
			const trusted = yield* Fiber.join(waiter);
			assert.strictEqual(trusted._tag, "Trusted");
			const marker = yield* readJson(DONE);
			assert.isTrue(trusted._tag === "Trusted" && trusted.owner === marker.nonce);
			assert.strictEqual(runs, 1);
		}).pipe(Effect.provide(platform())),
	);

	it.effect("the work's failure is re-raised after release, with no done marker", () =>
		Effect.gen(function* () {
			const error = yield* RunOnce.run(OPTIONS, Effect.fail("broke" as const)).pipe(Effect.flip);
			assert.strictEqual(error, "broke");
			assert.isFalse(yield* exists(LOCK));
			assert.isFalse(yield* exists(DONE));
		}).pipe(Effect.provide(platform())),
	);

	it.effect("interrupting the caller during the work releases the lock", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const fiber = yield* RunOnce.run(
				OPTIONS,
				Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
			).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			assert.isTrue(yield* exists(LOCK));
			const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause));
			assert.isFalse(yield* exists(LOCK));
			assert.isFalse(yield* exists(DONE));
		}).pipe(Effect.provide(platform())),
	);

	it.effect("a dead same-host owner is taken over without waiting", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(DIR, { recursive: true });
			yield* fs.writeFileString(LOCK, JSON.stringify({ pid: 1234, host: "here", nonce: "dead", startedAt: 0 }));
			const outcome = yield* RunOnce.run(OPTIONS, Effect.succeed(1));
			assert.deepStrictEqual(outcome, { _tag: "Ran", value: 1 });
		}).pipe(Effect.provide(platform((pid) => pid === 7))),
	);

	it.effect("a live owner past the deadline: runs unserialized on the Clock's deadline", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(DIR, { recursive: true });
			yield* fs.writeFileString(LOCK, JSON.stringify({ pid: 99, host: "here", nonce: "slow", startedAt: 0 }));
			const fiber = yield* RunOnce.run({ ...OPTIONS, waitTimeoutMs: 1000 }, Effect.succeed(1)).pipe(Effect.forkChild);
			yield* TestClock.adjust("1400 millis");
			assert.deepStrictEqual(yield* Fiber.join(fiber), { _tag: "RanUnserialized", value: 1, reason: "waitTimeout" });
			assert.isFalse(yield* exists(DONE));
		}).pipe(Effect.provide(platform())),
	);

	it.effect("bad wiring dies before any IO", () =>
		Effect.gen(function* () {
			const exit = yield* RunOnce.run({ key: "../x", dir: DIR }, Effect.succeed(1)).pipe(Effect.exit);
			assert.isTrue(Exit.isFailure(exit) && Result.isSuccess(Cause.findDefect(exit.cause)));
			assert.isFalse(yield* exists(DIR));
		}).pipe(Effect.provide(platform())),
	);

	it.effect("interrupting a POLLING waiter takes effect at once — the poll's sleep is interruptible", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(DIR, { recursive: true });
			yield* fs.writeFileString(LOCK, JSON.stringify({ pid: 99, host: "here", nonce: "busy", startedAt: 0 }));
			let ran = false;
			const waiter = yield* RunOnce.run(
				OPTIONS,
				Effect.sync(() => {
					ran = true;
				}),
			).pipe(Effect.forkChild);
			yield* TestClock.adjust("200 millis"); // one poll in: now asleep before the next
			const interrupter = yield* Fiber.interrupt(waiter).pipe(Effect.forkChild);
			for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
			// No clock movement: an uninterruptible sleep would leave the interrupter pending.
			assert.isDefined(interrupter.pollUnsafe(), "interrupting a polling waiter blocked on its sleep");
			assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(waiter)));
			assert.isFalse(ran);
			// The live owner's lock is untouched.
			assert.isTrue(yield* exists(LOCK));
		}).pipe(Effect.provide(platform())),
	);
});
