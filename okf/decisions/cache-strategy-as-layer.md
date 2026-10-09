---
type: Decision
title: Each runtimes resolver exposes three lazy layer constants, not one configurable layer
description: layer/layerFresh/layerOffline are memoized layer constants over a run-once population gate, never Effect.cached and never a fetch inside Layer.effect.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: a85ef16fe4b58c22def458e1aaafc87c157ac2e85f14072bc15bfd8e954a850e
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
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
call runs the population behind `internal/once.ts` — a semaphore-plus-`Ref`
run-once gate chosen deliberately over `Effect.cached`, which memoizes
the whole `Exit` and would let one transient failure, or an interrupted
first resolve, poison the layer for its entire lifetime. Success is
memoized, including the auto strategy's snapshot fallback; a **failed**
fresh population is not memoized, so the next `resolve` call retries.
Concurrent first resolves serialize on the gate and share one fetch.

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

**`Effect.cached` for the population gate.** Rejected because it memoizes
the whole `Exit`, success or failure. A transient network blip on the
first resolve — or an interrupted first resolve — would permanently
poison the layer for every subsequent call in the same process, with no
way to recover short of rebuilding the layer.

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
indistinguishable from a fresh one. Do not replace the run-once gate with
`Effect.cached`, and do not move the fetch back into `Layer.effect`;
either change reopens the poisoning or eager-IO failure modes this
decision closes.
