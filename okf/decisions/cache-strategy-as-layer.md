---
type: Decision
title: Each runtimes resolver exposes three lazy layer constants, not one configurable layer
description: layer/layerFresh/layerOffline are memoized layer constants over a run-once population gate (Effect.cachedWithTTL with an exit-keyed TTL), never bare Effect.cached and never a fetch inside Layer.effect.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T20:25:49Z
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
  - by: human:spencer
    at: 2026-10-25T20:04:29Z
integrity:
  generated:
    body: e73e2603595f2e39
  verified:
    by: human:spencer
    at: 2026-10-25T20:04:29Z
    content: de320bc92ab8527e
---

# Each runtimes resolver exposes three lazy layer constants, not one configurable layer

## Context

`@effected/runtimes` needs to offer a consumer three different answers to
"where do release versions come from": always fetch live and fall back to
a bundled snapshot on failure, fetch live and fail if that is not
possible, or use only the bundled snapshot with no IO at all. Each of the
three resolvers (Node, Bun, Deno) needs all three modes.

## Decision

Each resolver exposes three layer **constants**: `layer` (auto — fetch
live, fall back to the bundled snapshot and say so via the provenance
marker), `layerFresh` (live data or a typed failure) and `layerOffline`
(the snapshot; no IO, no requirements). Bound as constants per the kit's
memoization discipline, so a consumer never mints a fresh layer per call.

Every layer is lazy, and that is load-bearing: acquisition performs no
IO, so merging all three resolvers into one composed layer fetches
nothing until something actually resolves a version. The first `resolve`
call runs the population behind `internal/once.ts`, which is core's
`Effect.cachedWithTTL` with an exit-keyed time-to-live: infinite for a
success, zero for a failure or defect. Success is memoized, including the
auto strategy's snapshot fallback; a **failed** fresh population is not
memoized, so the next `resolve` call retries. Concurrent resolves join the
one in-flight population and share its outcome, a failure included: during
an outage every concurrent waiter receives the same `FreshnessError` from
one fetch, instead of each re-running the fetch in turn. Interruption is
never cached, and the population is interrupted only once every caller
waiting on it has left, so a waiter keeps an interrupted first caller's
run alive rather than starting another.

The lazy timing moves the strategy's error channel out of the layer and
into `resolve`: all three layers type `E = never`, and `resolve`'s error
union carries the freshness failure on all three resolvers. That is the
accepted cost of sharing one `Context.Service` shape per resolver —
`layer` and `layerOffline` advertise a failure channel they never
actually produce. `internal/strategy.ts` still types each strategy
exactly: only the fresh loader can fail, the auto loader falls back
instead, and the requirement channels stay per-strategy, so the offline
layer requires nothing at all.

The requirement channels differ deliberately, not by accident: Node needs
only `HttpClient`, because its dist index and release schedule are
unauthenticated, while Bun and Deno need `GitHubClient` and its
authenticated REST. Node resolution therefore works with zero GitHub
credentials, and `GitHubAuth` is a dependency only of the two GitHub-backed
resolvers.

## Alternatives rejected

**One configurable layer taking a strategy option.** Rejected because it
would collapse the requirement-channel distinction between Node and the
GitHub-backed resolvers into one shape that always demands
`GitHubClient`, forcing Node consumers to provide GitHub credentials they
do not need.

**Bare `Effect.cached` for the population gate.** Rejected because it
memoizes a failed `Exit` for the layer's lifetime. A transient network
blip on the first fresh resolve would permanently poison the layer for
every subsequent call in the same process, with no way to recover short
of rebuilding the layer. (Core never caches an interrupt, so an
interrupted first resolve is not the hazard; a failure is.)

**A hand-rolled semaphore-plus-`Ref` gate.** The package's original
mechanism, replaced by `Effect.cachedWithTTL`. It re-ran the fetch once
per concurrent waiter during an outage, each waiting behind the last, and
an interrupted first caller took the in-flight fetch down with it so the
next waiter started over. Core's primitive is stable, shares one run per
outage, and keeps an in-flight run alive while anyone still waits on it.

**Fetching inside `Layer.effect`, at acquisition time.** Rejected because
it makes merely composing the layer perform network IO, which breaks the
lazy-layer discipline the rest of the kit follows and would fetch data
for resolvers a consumer never actually calls.

## Consequences

A consumer who only wants the offline snapshot pays no IO and needs no
credentials at all. A consumer wanting live-with-fallback gets an honest
provenance marker on every answer — see
[provenance lives in the engine state](runtimes-provenance-in-engine-state.md) —
so a stale snapshot served after a silent network failure is never
indistinguishable from a fresh one. A `layerFresh` consumer resolving
concurrently during an outage sees every concurrent call fail together,
and the next call retry. Do not replace the exit-keyed TTL with bare
`Effect.cached`, and do not move the fetch back into `Layer.effect`;
either change reopens the poisoning or eager-IO failure modes this
decision closes.
