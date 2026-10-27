import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Latch } from "effect";
import { TestClock } from "effect/testing";
import { Exclusive, ExclusiveTimeout } from "../src/index.js";

const timeout = { timeout: "1 minute" } as const;

/** Yields to the scheduler enough times for forked fibers to reach their next suspension. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

describe("Exclusive.run", () => {
	it.effect("returns the body's value and propagates its failure", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			assert.strictEqual(yield* lane.run(Effect.succeed(7), timeout), 7);
			const failed = yield* Effect.flip(lane.run(Effect.fail("boom" as const), timeout));
			assert.strictEqual(failed, "boom");
		}),
	);

	it.effect("serializes two calls: the second body starts only after the first ends", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const gate = yield* Latch.make();
			const log: Array<string> = [];
			const first = yield* Effect.forkChild(
				lane.run(
					Effect.gen(function* () {
						log.push("first:start");
						yield* gate.await;
						log.push("first:end");
					}),
					timeout,
				),
			);
			yield* settle;
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => log.push("second:start")),
					timeout,
				),
			);
			yield* settle;
			assert.deepStrictEqual(log, ["first:start"]);
			yield* gate.open;
			yield* Fiber.join(first);
			yield* Fiber.join(second);
			assert.deepStrictEqual(log, ["first:start", "first:end", "second:start"]);
		}),
	);

	it.effect("a cancel while holding the permit waits for the body; the next call still waits for the real work", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const started = yield* Latch.make();
			const gate = yield* Latch.make();
			const log: Array<string> = [];
			const first = yield* Effect.forkChild(
				lane.run(
					Effect.gen(function* () {
						yield* started.open;
						yield* gate.await;
						log.push("first:end");
					}),
					timeout,
				),
			);
			yield* started.await;
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => log.push("second:start")),
					timeout,
				),
			);
			const cancel = yield* Effect.forkChild(Fiber.interrupt(first));
			yield* settle;
			assert.isUndefined(cancel.pollUnsafe(), "the cancel waits for the body");
			assert.deepStrictEqual(log, [], "the queued call has not run");
			yield* gate.open;
			yield* Fiber.join(cancel);
			yield* Fiber.join(second);
			assert.deepStrictEqual(log, ["first:end", "second:start"]);
			const firstExit = yield* Fiber.await(first);
			assert.isTrue(Exit.hasInterrupts(firstExit), "the cancelled caller sees its interruption");
		}),
	);

	it.effect("a cancel while queued leaves the queue; the body never runs", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const started = yield* Latch.make();
			const gate = yield* Latch.make();
			let ran = false;
			const first = yield* Effect.forkChild(lane.run(Effect.andThen(started.open, gate.await), timeout));
			yield* started.await;
			const queued = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => (ran = true)),
					timeout,
				),
			);
			yield* settle;
			yield* Fiber.interrupt(queued);
			yield* gate.open;
			yield* Fiber.join(first);
			const after = yield* lane.run(Effect.succeed("free"), timeout);
			assert.isFalse(ran);
			assert.strictEqual(after, "free", "the permit was not leaked by the cancelled waiter");
		}),
	);

	it.effect("the timeout interrupts the body; its finalizers run before the permit is released", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const log: Array<string> = [];
			const hung = Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.sync(() => log.push("restore")));
				log.push("hung:start");
				return yield* Effect.never;
			});
			const first = yield* Effect.forkChild(lane.run(hung, { timeout: "10 seconds" }));
			yield* settle;
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => log.push("second:start")),
					timeout,
				),
			);
			yield* settle;
			yield* TestClock.adjust("9 seconds");
			assert.deepStrictEqual(log, ["hung:start"], "not yet timed out");
			yield* TestClock.adjust("1 second");
			const error = yield* Effect.flip(Fiber.join(first));
			yield* Fiber.join(second);
			assert.instanceOf(error, ExclusiveTimeout);
			assert.strictEqual(error.timeout, "10s");
			assert.deepStrictEqual(log, ["hung:start", "restore", "second:start"]);
		}),
	);

	it.effect("an asynchronous finalizer holds both the timeout result and the permit until it finishes", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const gate = yield* Latch.make();
			const log: Array<string> = [];
			const hung = Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.andThen(
						gate.await,
						Effect.sync(() => log.push("restore")),
					),
				);
				return yield* Effect.never;
			});
			const first = yield* Effect.forkChild(lane.run(hung, { timeout: "10 seconds" }));
			yield* settle;
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => log.push("second:start")),
					timeout,
				),
			);
			yield* settle;
			yield* TestClock.adjust("10 seconds");
			yield* settle;
			assert.isUndefined(first.pollUnsafe(), "the timeout is not reported while the finalizer runs");
			assert.deepStrictEqual(log, [], "the permit is still held");
			yield* gate.open;
			assert.instanceOf(yield* Effect.flip(Fiber.join(first)), ExclusiveTimeout);
			yield* Fiber.join(second);
			assert.deepStrictEqual(log, ["restore", "second:start"]);
		}),
	);

	it.effect("a body that finishes inside the timeout is never reported as timed out", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const run = yield* Effect.forkChild(
				lane.run(Effect.as(Effect.sleep("5 seconds"), "done"), { timeout: "10 seconds" }),
			);
			yield* settle;
			yield* TestClock.adjust("5 seconds");
			assert.strictEqual(yield* Fiber.join(run), "done");
		}),
	);
});

describe("Exclusive.run edges", () => {
	it.effect("not reentrant: a nested run on the same lane surfaces as the outer ExclusiveTimeout", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			let innerRan = false;
			const outer = yield* Effect.forkChild(
				lane.run(
					lane.run(
						Effect.sync(() => (innerRan = true)),
						timeout,
					),
					{ timeout: "10 seconds" },
				),
			);
			yield* settle;
			yield* TestClock.adjust("10 seconds");
			const error = yield* Effect.flip(Fiber.join(outer));
			assert.instanceOf(error, ExclusiveTimeout);
			assert.isFalse(innerRan);
			assert.strictEqual(yield* lane.run(Effect.succeed("free"), timeout), "free", "the permit was released");
		}),
	);

	it.effect("leaves no live child in the caller's fiber: the timer is stopped when the body ends", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			// `children()` is FiberImpl's (internal/effect.ts), not on the public Fiber interface; it is the only
			// observation of a forkChild child that outlives the call it was forked for.
			const liveChildren = Effect.withFiber((fiber) =>
				Effect.succeed((fiber as unknown as { children(): Set<unknown> }).children().size),
			);
			const before = yield* liveChildren;
			for (let i = 0; i < 3; i++) yield* lane.run(Effect.void, { timeout: "1 hour" });
			assert.strictEqual(yield* liveChildren, before);
		}),
	);
});

describe("Exclusive.promise", () => {
	it.live("an interrupt aborts the signal and then waits for the promise to settle", () =>
		Effect.gen(function* () {
			const events: Array<string> = [];
			const fiber = yield* Effect.forkChild(
				Exclusive.promise({
					try: (signal) =>
						new Promise<string>((resolve) => {
							signal.addEventListener("abort", () => events.push("abort"));
							setTimeout(() => {
								events.push("settled");
								resolve("late");
							}, 30);
						}),
					catch: (cause) => cause,
				}),
			);
			yield* Effect.sleep("5 millis");
			yield* Fiber.interrupt(fiber);
			events.push("interrupt-returned");
			assert.deepStrictEqual(events, ["abort", "settled", "interrupt-returned"]);
		}),
	);

	it.live("control: Effect.promise abandons the promise, so its interrupt returns first", () =>
		Effect.gen(function* () {
			const events: Array<string> = [];
			const fiber = yield* Effect.forkChild(
				Effect.promise(
					() =>
						new Promise<void>((resolve) =>
							setTimeout(() => {
								events.push("settled");
								resolve();
							}, 30),
						),
				),
			);
			yield* Effect.sleep("5 millis");
			yield* Fiber.interrupt(fiber);
			events.push("interrupt-returned");
			yield* Effect.sleep("40 millis");
			assert.deepStrictEqual(events, ["interrupt-returned", "settled"]);
		}),
	);

	it.effect("maps a rejection and a synchronous throw through catch", () =>
		Effect.gen(function* () {
			const rejected = yield* Effect.flip(
				Exclusive.promise({ try: () => Promise.reject(new Error("no")), catch: (cause) => `caught:${String(cause)}` }),
			);
			assert.strictEqual(rejected, "caught:Error: no");
			const thrown = yield* Effect.flip(
				Exclusive.promise({
					try: () => {
						throw new Error("sync");
					},
					catch: (cause) => `caught:${String(cause)}`,
				}),
			);
			assert.strictEqual(thrown, "caught:Error: sync");
		}),
	);

	it.live("as a lane body, a timeout waits for the promise before releasing the permit", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const events: Array<string> = [];
			const body = Exclusive.promise({
				try: () =>
					new Promise<void>((resolve) =>
						setTimeout(() => {
							events.push("settled");
							resolve();
						}, 40),
					),
				catch: (cause) => cause,
			});
			const first = yield* Effect.forkChild(lane.run(body, { timeout: "5 millis" }));
			yield* Effect.sleep("1 millis");
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => events.push("second")),
					timeout,
				),
			);
			const error = yield* Effect.flip(Fiber.join(first));
			yield* Fiber.join(second);
			assert.instanceOf(error, ExclusiveTimeout);
			assert.deepStrictEqual(events, ["settled", "second"]);
		}),
	);

	/** Resolves after `ms`, ignoring its signal: the shape of a runner's `start` that never observes cancellation. */
	const ignoresSignal = (events: Array<string>, ms: number) => (signal: AbortSignal) =>
		new Promise<string>((resolve) => {
			signal.addEventListener("abort", () => events.push("abort"));
			setTimeout(() => {
				events.push("settled");
				resolve("late");
			}, ms);
		});

	it.live("abandon: an interrupt aborts the signal and returns without waiting for the promise", () =>
		Effect.gen(function* () {
			const events: Array<string> = [];
			const fiber = yield* Effect.forkChild(
				Exclusive.promise({ try: ignoresSignal(events, 40), catch: (cause) => cause, abandon: true }),
			);
			yield* Effect.sleep("5 millis");
			const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
			events.push("interrupt-returned");
			assert.isTrue(Exit.hasInterrupts(exit));
			yield* Effect.sleep("60 millis");
			assert.deepStrictEqual(events, ["abort", "interrupt-returned", "settled"]);
		}),
	);

	it.effect("abandon: an uninterrupted promise still resolves and rejects as usual", () =>
		Effect.gen(function* () {
			const value = yield* Exclusive.promise({ try: () => Promise.resolve(3), catch: (cause) => cause, abandon: true });
			assert.strictEqual(value, 3);
			const failed = yield* Effect.flip(
				Exclusive.promise({
					try: () => Promise.reject("no"),
					catch: (cause) => `caught:${String(cause)}`,
					abandon: true,
				}),
			);
			assert.strictEqual(failed, "caught:no");
		}),
	);

	it.live("abandon as a lane body: the timeout returns early, but the scope closes before the permit is released", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const events: Array<string> = [];
			const body = Effect.gen(function* () {
				yield* Effect.addFinalizer(() =>
					Effect.sleep("10 millis").pipe(Effect.andThen(Effect.sync(() => events.push("finalizer")))),
				);
				return yield* Exclusive.promise({ try: ignoresSignal(events, 80), catch: (cause) => cause, abandon: true });
			});
			const first = yield* Effect.forkChild(lane.run(body, { timeout: "5 millis" }));
			yield* Effect.sleep("1 millis");
			const second = yield* Effect.forkChild(
				lane.run(
					Effect.sync(() => events.push("second")),
					timeout,
				),
			);
			const error = yield* Effect.flip(Fiber.join(first));
			events.push("timeout-seen");
			yield* Fiber.join(second);
			assert.instanceOf(error, ExclusiveTimeout);
			assert.deepStrictEqual(events.slice(0, 2), ["abort", "finalizer"], "the finalizer runs before release");
			assert.notInclude(events, "settled", "the abandoned promise has not settled yet");
			assert.sameMembers(events.slice(2), ["timeout-seen", "second"]);
			yield* Effect.sleep("100 millis");
			assert.strictEqual(events.at(-1), "settled");
		}),
	);
});

describe("Exclusive.promise: a catch that throws", () => {
	const boom = new Error("catch threw");
	const throwingCatch = (): never => {
		throw boom;
	};
	/** Fails the test fast instead of hanging when the promise never resumes. */
	const hard = <A, E>(self: Effect.Effect<A, E>) =>
		self.pipe(
			Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.die(new Error("hung: never resumed")) }),
		);
	/** Collects every unhandled rejection raised while `self` runs, plus a short grace period. */
	const watchUnhandled = <A, E>(self: Effect.Effect<A, E>) =>
		Effect.acquireUseRelease(
			Effect.sync(() => {
				const seen: Array<unknown> = [];
				const listener = (reason: unknown) => seen.push(reason);
				process.on("unhandledRejection", listener);
				return { seen, listener };
			}),
			({ seen }) =>
				Effect.exit(self).pipe(Effect.flatMap((exit) => Effect.as(Effect.sleep("30 millis"), { exit, seen }))),
			({ listener }) => Effect.sync(() => process.off("unhandledRejection", listener)),
		);
	const assertDiedWithBoom = (exit: Exit.Exit<unknown, unknown>) => {
		assert.isTrue(Exit.isFailure(exit), "the promise resumed as a failure");
		if (Exit.isFailure(exit)) {
			assert.isTrue(Cause.hasDies(exit.cause), Cause.pretty(exit.cause));
			assert.strictEqual(Cause.squash(exit.cause), boom);
		}
	};

	it.live("a rejection dies with the thrown error instead of hanging", () =>
		Effect.gen(function* () {
			const { exit, seen } = yield* watchUnhandled(
				hard(Exclusive.promise({ try: () => Promise.reject(new Error("no")), catch: throwingCatch })),
			);
			assertDiedWithBoom(exit);
			assert.deepStrictEqual(seen, [], "no unhandled rejection");
		}),
	);

	it.live("abandon: a rejection dies with the thrown error instead of hanging", () =>
		Effect.gen(function* () {
			const { exit, seen } = yield* watchUnhandled(
				hard(Exclusive.promise({ try: () => Promise.reject(new Error("no")), catch: throwingCatch, abandon: true })),
			);
			assertDiedWithBoom(exit);
			assert.deepStrictEqual(seen, [], "no unhandled rejection");
		}),
	);

	it.live("abandon: a rejection after the interrupt raises no unhandled rejection", () =>
		Effect.gen(function* () {
			const { seen } = yield* watchUnhandled(
				Effect.gen(function* () {
					const fiber = yield* Effect.forkChild(
						Exclusive.promise({
							try: () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late")), 20)),
							catch: throwingCatch,
							abandon: true,
						}),
					);
					yield* Effect.sleep("5 millis");
					yield* hard(Fiber.interrupt(fiber));
					yield* Effect.sleep("40 millis");
				}),
			);
			assert.deepStrictEqual(seen, [], "the dropped rejection is observed");
		}),
	);

	it.live("a synchronous throw from try still dies with the thrown error", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				hard(
					Exclusive.promise({
						try: () => {
							throw new Error("sync");
						},
						catch: throwingCatch,
					}),
				),
			);
			assertDiedWithBoom(exit);
		}),
	);

	it.live("as a lane body, it dies rather than holding the permit until the timeout", () =>
		Effect.gen(function* () {
			const lane = yield* Exclusive.make;
			const exit = yield* Effect.exit(
				hard(
					lane.run(Exclusive.promise({ try: () => Promise.reject(new Error("no")), catch: throwingCatch }), {
						timeout: "1 second",
					}),
				),
			);
			assertDiedWithBoom(exit);
			assert.strictEqual(yield* hard(lane.run(Effect.succeed("next"), timeout)), "next");
		}),
	);
});
