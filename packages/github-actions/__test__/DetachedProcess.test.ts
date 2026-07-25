import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { DetachedProcess, DetachedProcessError, ProcessId } from "../src/index.js";

/** A fresh scratch directory per use, removed by the test that made it. */
const scratch = () => mkdtempSync(join(tmpdir(), "effected-detached-"));

/** Wait for a real condition without a real sleep loop in the assertion. */
const eventually = async (predicate: () => boolean, attempts = 100): Promise<boolean> => {
	for (let remaining = attempts; remaining > 0; remaining -= 1) {
		if (predicate()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return predicate();
};

/** Whether a pid is still alive, asked without signalling it. */
const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/**
 * Run an effect with `process.kill` replaced, restoring it on every exit path.
 *
 * @remarks
 * `acquireUseRelease` rather than `try`/`finally`, because a failing assertion
 * inside `Effect.gen` leaves through the error channel — and a spy on a real
 * process global that survives its own test poisons every later one, including
 * the control that proves the guard is not simply refusing everything.
 */
const withKillSpy = <A, E>(
	implementation: () => true,
	use: (calls: ReadonlyArray<ReadonlyArray<unknown>>) => Effect.Effect<A, E>,
) =>
	Effect.acquireUseRelease(
		Effect.sync(() => vi.spyOn(process, "kill").mockImplementation(implementation as never)),
		(spy) => use(spy.mock.calls),
		(spy) => Effect.sync(() => spy.mockRestore()),
	);

describe("DetachedProcess", () => {
	describe("the bare-pid guard", () => {
		it.effect("refuses pid 0 WITHOUT signalling anything", () =>
			// The assertion that matters is the spy, not the failure. pid 0 signals
			// the caller's entire process group, so on a runner an unguarded reap of a
			// state value that decoded to 0 takes down the job running it. A test that
			// only checked the effect failed would pass against an implementation that
			// killed the group and THEN reported an error.
			withKillSpy(
				() => true,
				(calls) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(DetachedProcess.reap(0));
						assert.instanceOf(error, DetachedProcessError);
						assert.strictEqual(error.reason, "invalidPid");
						assert.lengthOf(calls, 0, "process.kill must not have been called at all");
					}),
			),
		);

		it.effect("refuses pid -1 WITHOUT signalling anything", () =>
			// -1 is worse than 0: it signals every process the user owns.
			withKillSpy(
				() => true,
				(calls) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(DetachedProcess.reap(-1));
						assert.strictEqual(error.reason, "invalidPid");
						assert.lengthOf(calls, 0, "process.kill must not have been called at all");
					}),
			),
		);

		it.effect("refuses a non-integer pid", () =>
			withKillSpy(
				() => true,
				(calls) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(DetachedProcess.reap(Number.NaN));
						assert.strictEqual(error.reason, "invalidPid");
						assert.lengthOf(calls, 0);
					}),
			),
		);

		it.effect("the control: a positive pid DOES reach process.kill", () =>
			// Without this, the three tests above pass against an implementation that
			// never signals anything at all.
			withKillSpy(
				() => true,
				(calls) =>
					Effect.gen(function* () {
						assert.isTrue(yield* DetachedProcess.reap(4242, "SIGTERM"));
						assert.deepStrictEqual(calls, [[4242, "SIGTERM"]]);
					}),
			),
		);
	});

	describe("reap", () => {
		it.effect("reports an already-dead process as false rather than failing", () =>
			withKillSpy(
				() => {
					throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
				},
				() =>
					Effect.gen(function* () {
						// A post phase finding its child already gone is the normal ending.
						assert.isFalse(yield* DetachedProcess.reap(4242));
					}),
			),
		);

		it.effect("fails typed when the signal is refused", () =>
			withKillSpy(
				() => {
					throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
				},
				() =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(DetachedProcess.reap(4242));
						assert.strictEqual(error.reason, "signalFailed");
						assert.strictEqual(error.pid, 4242);
					}),
			),
		);
	});

	describe("ProcessId", () => {
		it("refuses the zero a truncated state file decodes to", () => {
			// Both defenses matter and this is the first: the bad value never reaches
			// reap, because it never leaves ActionState.
			assert.strictEqual(Schema.decodeUnknownExit(ProcessId)(0)._tag, "Failure");
			assert.strictEqual(Schema.decodeUnknownExit(ProcessId)(-1)._tag, "Failure");
			assert.strictEqual(Schema.decodeUnknownExit(ProcessId)(1.5)._tag, "Failure");
		});

		it.effect("accepts a real pid", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Schema.decodeUnknownEffect(ProcessId)(4242), 4242);
			}),
		);
	});

	describe("awaitReady", () => {
		it.effect("returns as soon as the probe holds, without waiting", () =>
			Effect.gen(function* () {
				let calls = 0;
				yield* DetachedProcess.awaitReady(
					Effect.sync(() => {
						calls += 1;
						return true;
					}),
				);
				assert.strictEqual(calls, 1, "a probe that already holds must not be retried");
			}),
		);

		it.effect("polls until the probe holds", () =>
			Effect.gen(function* () {
				let calls = 0;
				const probe = Effect.sync(() => {
					calls += 1;
					return calls >= 3;
				});
				const fiber = yield* Effect.forkChild(DetachedProcess.awaitReady(probe, { interval: "100 millis" }));
				// Latch-free but clock-driven: it.effect installs a virtual clock, so a
				// real sleep here would hang to the vitest timeout instead of ticking.
				yield* TestClock.adjust("100 millis");
				yield* TestClock.adjust("100 millis");
				yield* Fiber.join(fiber);
				assert.strictEqual(calls, 3);
			}),
		);

		it.effect("fails typed once the attempts are exhausted", () =>
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					Effect.flip(DetachedProcess.awaitReady(Effect.succeed(false), { interval: "10 millis", attempts: 2 })),
				);
				yield* TestClock.adjust("10 millis");
				yield* TestClock.adjust("10 millis");
				const error = yield* Fiber.join(fiber);
				assert.strictEqual(error.reason, "notReady");
			}),
		);

		it.effect("propagates a probe failure rather than retrying it", () =>
			Effect.gen(function* () {
				let calls = 0;
				const probe = Effect.suspend(() => {
					calls += 1;
					return Effect.fail("probe is misconfigured" as const);
				});
				// A probe that cannot run is a different situation from a child that is
				// not up yet; retrying the first turns a config error into a timeout
				// with nothing to show for it.
				const error = yield* Effect.flip(DetachedProcess.awaitReady(probe, { attempts: 5 }));
				assert.strictEqual(error, "probe is misconfigured");
				assert.strictEqual(calls, 1);
			}),
		);
	});

	describe("spawn", () => {
		it.live("starts a detached child, routes its output to the log file, and survives to be reaped", () => {
			const directory = scratch();
			const logFile = join(directory, "child.log");
			return Effect.gen(function* () {
				const pid = yield* DetachedProcess.spawn({
					command: process.execPath,
					args: ["-e", "process.stdout.write('hello from the child\\n'); setTimeout(() => {}, 30000);"],
					logFile,
				});
				assert.isAbove(pid, 0);

				// The parent closed its own descriptor immediately; the child holds a
				// duplicate, which is what keeps the log filling after this process
				// would have exited.
				const wrote = yield* Effect.promise(() =>
					eventually(() => {
						try {
							return readFileSync(logFile, "utf8").includes("hello from the child");
						} catch {
							return false;
						}
					}),
				);
				assert.isTrue(wrote, "the child's stdout must reach the log file");

				assert.isTrue(yield* DetachedProcess.reap(pid));
				const gone = yield* Effect.promise(() => eventually(() => !alive(pid)));
				assert.isTrue(gone, "the reaped child must actually exit");
			}).pipe(Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true }))));
		});

		it.live("fails typed when the command does not exist", () => {
			const directory = scratch();
			return Effect.gen(function* () {
				const error = yield* Effect.flip(
					DetachedProcess.spawn({
						command: join(directory, "no-such-binary"),
						logFile: join(directory, "child.log"),
					}),
				);
				assert.strictEqual(error.reason, "spawnFailed");
			}).pipe(Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true }))));
		});

		it.live("fails typed when the log file cannot be opened", () => {
			const directory = scratch();
			return Effect.gen(function* () {
				const error = yield* Effect.flip(
					DetachedProcess.spawn({
						command: process.execPath,
						args: ["-e", ""],
						logFile: join(directory, "missing", "child.log"),
					}),
				);
				assert.strictEqual(error.reason, "logUnavailable");
				assert.include(String(error.path), "child.log");
			}).pipe(Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true }))));
		});
	});
});
