/**
 * A run-at-most-once gate for deferred layer population.
 *
 * The resolver layers are lazy: acquiring one performs no IO, and the feed
 * fetch happens on the first `resolve`. This helper is the memoization behind
 * that contract, chosen over `Effect.cached` deliberately — `cached` memoizes
 * the *Exit*, so a transient network failure (or an interrupted first resolve)
 * would poison the resolver for the layer's whole lifetime.
 *
 * Semantics, exactly:
 *
 * - **Success is memoized.** The first successful run flips the gate; every
 *   later and every concurrently-waiting caller skips the work.
 * - **Concurrent first callers share one run.** A semaphore serializes entry;
 *   waiters re-check the gate under the permit and skip when the winner
 *   succeeded.
 * - **Failure is not memoized.** The gate only flips after success, so a
 *   failed run leaves it open and the next caller retries. Same for an
 *   interrupted run — `withPermits` releases the permit on interruption.
 *
 * The effect's requirements are captured from the *acquiring* scope
 * (`Effect.context`), so the gated effect needs nothing at call time — which
 * is what lets a lazy `resolve` keep `R = never` while the layer still
 * honestly advertises the strategy's requirements.
 *
 * @internal
 */

import { Effect, Ref, Semaphore } from "effect";

/**
 * Capture `effect`'s requirements now; return a gated effect that runs it at
 * most once successfully, retrying after failure or interruption.
 */
export const once = <E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<Effect.Effect<void, E>, never, R> =>
	Effect.gen(function* () {
		const context = yield* Effect.context<R>();
		const done = yield* Ref.make(false);
		const gate = yield* Semaphore.make(1);
		const run = gate.withPermits(1)(
			Effect.gen(function* () {
				// Re-checked under the permit: a waiter whose predecessor succeeded
				// must skip, one whose predecessor failed must retry.
				if (yield* Ref.get(done)) return;
				yield* Effect.provideContext(effect, context);
				yield* Ref.set(done, true);
			}),
		);
		return Effect.gen(function* () {
			// The cheap fast path: after the first success, resolves never touch
			// the semaphore at all.
			if (yield* Ref.get(done)) return;
			yield* run;
		});
	});
