// A run-once gate for deferred layer population.
//
// The resolver layers are lazy: acquiring one performs no IO, and the feed
// fetch happens on the first `resolve`. This helper is the memoization behind
// that contract: core's `Effect.cachedWithTTL` with an exit-keyed TTL —
// infinite for a success, zero for anything else. Bare `Effect.cached` is the
// rejected alternative: it memoizes a failed Exit forever, so one transient
// network failure would poison a `layerFresh` resolver for the layer's whole
// lifetime.
//
// Semantics, exactly:
//
// - **Success is memoized.** Every later caller replays it without running
//   the population again.
// - **Failure and defect are not memoized.** A zero TTL expires the Exit
//   immediately, so the next caller retries.
// - **Concurrent callers share one run, outcome included.** Callers arriving
//   while a population is in flight join it; when it fails, every one of them
//   receives that failure (one fetch per outage, not one per waiter). Only the
//   fresh strategy can fail at all.
// - **Interruption is never cached.** The run is interrupted only once every
//   caller waiting on it has left; a waiter keeps an interrupted first
//   caller's run alive rather than starting another.
//
// The effect's requirements are captured from the *acquiring* scope
// (`Effect.context`), so the gated effect needs nothing at call time — which
// is what lets a lazy `resolve` keep `R = never` while the layer still
// honestly advertises the strategy's requirements. That capture, shared by two
// call sites, is why this stays a helper rather than an inline call.

import { Duration, Effect, Exit } from "effect";

/**
 * Capture `effect`'s requirements now; return a gated effect that runs it at
 * most once successfully, shares an in-flight run with concurrent callers, and
 * lets the next caller retry after a failure.
 */
export const once = <E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<Effect.Effect<void, E>, never, R> =>
	Effect.gen(function* () {
		const context = yield* Effect.context<R>();
		return yield* Effect.cachedWithTTL(Effect.provideContext(effect, context), (exit) =>
			Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
		);
	});
