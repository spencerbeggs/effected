# Timeouts and interruption

The three `Effect.timeout` forms, what a timeout does to the source effect, and
why core `HttpClient` needs no `AbortSignal` from you.

## Three forms

Exactly three exist — `timeoutFail` and `timeoutTo` are both `undefined`.

| Form | On timeout | Signature shape |
| --- | --- | --- |
| `Effect.timeout(duration)` | fails with **`Cause.TimeoutError`** (added to `E`) | `Effect<A, E \| Cause.TimeoutError, R>` |
| `Effect.timeoutOption(duration)` | succeeds with `Option.none()` — no added error | `Effect<Option<A>, E, R>` |
| `Effect.timeoutOrElse({ duration, orElse })` | runs the fallback (the old `timeoutTo`/`timeoutFail` shape) | `Effect<A \| A2, E \| E2, R \| R2>` |

## Timing out interrupts the source

**When the timeout wins, the source effect is interrupted** — its finalizers
run, so scoped resources clean up: a timed-out subprocess spawn closes its
scope and kills the child, a timed-out acquire releases. A per-operation
ceiling is therefore `op.pipe(Effect.timeout("30 seconds"))` composed by the
*caller* — never a bespoke timeout parameter threaded through a service.

The one sanctioned exception is a **package-owned ceiling that is part of the
service's error contract**: `@effected/git`'s `runClassified` owns a fixed
30s ceiling internally and maps expiry to its own `GitCommandError`, so
`Cause.TimeoutError` never escapes its methods — the ceiling is absorbed
into the taxonomy, not exposed as a parameter.

## Interruption reaches the network — never wire an `AbortSignal` into core `HttpClient`

Core's `HttpClient` already cancels the request: `HttpClient.make` gives every
request its own `AbortController` and aborts it when the calling fiber is
interrupted, and keeps it armed while the body is read (text, JSON, bytes or a
stream). So a timeout, a `Fiber.interrupt` or a lost race releases the
connection with no code of yours. Never build an `AbortController`, merge a
signal into request options, or pass one through a service for an
`HttpClient` call — that duplicates core's wiring and drifts from it.

For a promise **outside** `HttpClient` — an SDK such as octokit, or a raw
`fetch` you cannot replace — use the signal `Effect.tryPromise` hands you:
`Effect.tryPromise({ try: (signal) => sdk.call({ signal }), catch: … })`. It
is aborted when the fiber is interrupted, the same way.
