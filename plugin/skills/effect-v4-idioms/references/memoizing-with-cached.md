# Memoizing with `Effect.cached` — failures included, interrupts never

`Effect.cached(self)` returns `Effect<Effect<A, E, R>>` whose inner effect
replays the **first completed `Exit`**, whether it was a success or a failure. A
failure is cached for the life of the memo.

## Interruption is never cached

Core treats interruption as abandonment (`makeCachedUnsafe` in
`internal/effect.ts`). Concurrent callers share one in-flight run, and when
every caller has left (each one interrupted by an `Effect.timeout`, an
`Effect.race` or a cancelled request) the run is interrupted and detached, and
the next caller starts a fresh one. A source that interrupts itself is not
stored either, so the next call re-runs it. Probed: an interrupted sole first
caller, then a second call, ran the source twice and the second call
succeeded. The control was a failing source, which ran once across two calls.

## Failure caching defeats the caller's retry

A caller reaching for the natural spelling, `Effect.retry(useTheMemo(), policy)`,
silently does nothing: each retry replays the cached `Exit` without re-running
the underlying effect. Library-side failure caching takes away the caller's
ability to own the retry policy.

## Success-only memoization

Give `Effect.cachedWithTTL` a TTL keyed on the exit:

```ts
const memo = yield* Effect.cachedWithTTL(expensiveEffect, (exit) =>
  Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
)
```

Success is computed once, across sequential and concurrent observers. A failure
expires as soon as it is written, so the next call re-runs the source, and
callers bound their own retries by wrapping the *inner* effect. Use bare
`Effect.cached` only when you want a terminal failure, and say so in the TSDoc,
because a consumer will not guess it.
