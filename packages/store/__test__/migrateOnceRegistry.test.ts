import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Scheduler } from "effect";
import { runOnce } from "../src/internal/migrateOnce.js";

let keyCount = 0;
/** A key no other test (or earlier iteration) has used: the registry is process-wide. */
const freshKey = (): string => {
	keyCount += 1;
	return `/migrate-once-registry-test/${keyCount}\u0000[]`;
};

describe("runOnce: the registry behind Store.migrateOnce", () => {
	it.live("a caller interrupted at any scheduler yield never strands the key", () =>
		Effect.gen(function* () {
			// A tiny op budget makes the first caller yield between almost every
			// step, so interrupting it lands between registration and the fork for
			// some budget/yield pair. Before the uninterruptible mask, that left a
			// registered promise no fiber would ever settle: the run never started
			// and every later caller for the key waited forever.
			// Budget 1 is left out: on it the runtime cannot interrupt even a bare
			// `Effect.never` once the child has yielded (a scratchpad control showed
			// `Fiber.interrupt` hanging there with no `runOnce` involved), so it
			// would measure the scheduler, not this code. Budgets 3 and 4 are the
			// ones that stranded the key before the fix.
			for (let budget = 2; budget <= 8; budget++) {
				for (let yields = 0; yields <= 3; yields++) {
					const key = freshKey();
					let runs = 0;
					const work = Effect.sync(() => {
						runs += 1;
					});
					const first = yield* Effect.forkChild(
						runOnce<never>(key, work).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, budget)),
					);
					for (let n = 0; n < yields; n++) yield* Effect.yieldNow;
					yield* Fiber.interrupt(first);
					const second = yield* runOnce<never>(key, work).pipe(Effect.timeoutOption("250 millis"));
					assert.isTrue(Option.isSome(second), `budget ${budget}, ${yields} yields: the second caller hung`);
					assert.isAtMost(runs, 2, `budget ${budget}, ${yields} yields`);
					assert.isAtLeast(runs, 1, `budget ${budget}, ${yields} yields`);
				}
			}
		}),
	);

	it.live("a failed entry is gone by the time its waiters are released", () =>
		Effect.gen(function* () {
			const key = freshKey();
			let runs = 0;
			const failing = Effect.suspend(() => {
				runs += 1;
				return Effect.fail("boom" as const);
			});
			const succeeding = Effect.sync(() => {
				runs += 1;
			});
			// Each waiter, the moment the failure releases it, starts its own call.
			// Were the failed entry still registered then, the retry would join the
			// failed promise and fail again without running.
			const retried = yield* Effect.all(
				Array.from({ length: 3 }, () =>
					runOnce<"boom">(key, failing).pipe(
						Effect.flip,
						Effect.flatMap((error) => Effect.as(Effect.exit(runOnce<"boom">(key, succeeding)), error)),
					),
				),
				{ concurrency: "unbounded" },
			);
			assert.deepStrictEqual(retried, ["boom", "boom", "boom"]);
			// One failing run, then exactly one shared retry run.
			assert.strictEqual(runs, 2);
			const after = yield* Effect.exit(runOnce<"boom">(key, failing));
			assert.isTrue(Exit.isSuccess(after), "the successful retry is what stays registered");
		}),
	);

	it.live("a waiter in the copy that ran keeps the run's whole cause, every defect included", () =>
		Effect.gen(function* () {
			const key = freshKey();
			const dying = Effect.andThen(
				Effect.sleep("10 millis"),
				Effect.failCause(Cause.combine(Cause.die("a"), Cause.die("b"))),
			);
			const exits = yield* Effect.all(
				[Effect.exit(runOnce<never>(key, dying)), Effect.exit(runOnce<never>(key, dying))],
				{
					concurrency: "unbounded",
				},
			);
			for (const exit of exits) {
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					const defects = exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
					assert.deepStrictEqual(defects, ["a", "b"]);
				}
			}
		}),
	);

	it.live("an outcome another copy registered is read through the frozen plain shape", () =>
		Effect.gen(function* () {
			// Another copy's run: the registry entry is all it shares, never its Cause.
			const runs = (globalThis as { [key: symbol]: Map<string, Promise<unknown>> | undefined })[
				Symbol.for("@effected/store/migrateOnce")
			];
			assert.isDefined(runs, "earlier tests created the registry");
			const failed = freshKey();
			const died = freshKey();
			runs?.set(failed, Promise.resolve({ _tag: "Failure", error: { _tag: "StoreError" } }));
			runs?.set(died, Promise.resolve({ _tag: "Defect", defect: "elsewhere" }));
			const work = Effect.die("must not run");
			assert.deepStrictEqual(yield* Effect.flip(runOnce<{ readonly _tag: string }>(failed, work)), {
				_tag: "StoreError",
			});
			const exit = yield* Effect.exit(runOnce<never>(died, work));
			assert.isTrue(Exit.isFailure(exit) && Cause.squash(exit.cause) === "elsewhere");
		}),
	);
});
