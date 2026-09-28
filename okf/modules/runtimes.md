---
type: Module
title: runtimes
description: Resolves semver-compatible Node.js, Bun and Deno versions from live release feeds, with a bundled offline snapshot as fallback.
status: stable
kind: package
resource: ../../packages/runtimes
tags:
  - architecture
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: a4e1d54883623705d3d6d901df7fa58e039bcbd8cd233844a7e32fe017172b26
---

# runtimes

## Purpose

`@effected/runtimes` resolves semver-compatible versions of Node.js, Bun
and Deno from live release feeds, falling back to a bundled offline
snapshot. Three resolver services (`NodeResolver`, `BunResolver`,
`DenoResolver`), each exposing three cache strategies, sit over one
parameterized internal engine.

The library and its CLI live in different repositories, deliberately. A
`runtime-resolver` binary ships from the external `runtime-resolver`
repository against the published `@effected/runtimes`; nothing in this
workspace builds it. A CLI needs `@effect/platform-node`, an
integrated-tier dependency, and keeping the binary out is what keeps that
dependency out of this library's own consumers — the library reaches the
consuming applications, the binary does not.

## Tier and dependencies

Boundary tier. IO goes entirely through `effect`-core abstractions; the
consumer provides the platform layer at the edge. `peerDependencies` is
`effect` alone; `dependencies` is `@effected/semver`
(`packages/runtimes/package.json`) and nothing else, for all version
math — no external runtime dependency, and that constraint is the whole
reason the CLI lives in a separate repository.

The version math uses `@effected/semver`'s `SemVer` and `Range`
**directly**, not its `VersionCache` service: `VersionCache` is a
singleton `Context.Service`, and this package needs three independent
indices — Node, Bun, Deno — live at once, which a singleton cannot
provide without three tags.

## HTTP over core, no Octokit

All network access goes through `HttpClient` from `effect/http`,
with the consumer providing a fetch-backed layer at the edge that has no
requirements of its own. See
[HTTP over core, no Octokit](../decisions/runtimes-http-over-core-no-octokit.md).

## Module layout

Public concept modules under `src/`: the three resolvers
(`NodeResolver.ts`, `BunResolver.ts`, `DenoResolver.ts`), plus
`ResolvedVersions.ts`, `GitHub.ts`, `NodeSchedule.ts` and
`NodeRelease.ts`, over an `internal/` engine.

The strategy collapse is the layout's centerpiece: `internal/strategy.ts`
is parameterized once, so the three public resolver files expose the
strategies as named layer constants rather than each owning a
hand-written cache-and-fetcher stack. `internal/githubRuntime.ts` is the
shared Bun/Deno layer builder — the two are the same resolver pointed at
a different repository — and `internal/resolve.ts` is the single
filter/group/rank/package pipeline. `NodeRelease.ts` and `NodeSchedule.ts`
stay split for Node alone, because the schedule is a separate concept
with its own lifecycle model and Node's release carries an extra field.

`internal/defaults/` holds the three generated offline snapshots — see
[the bundled defaults data model](../models/runtimes-bundled-defaults.md)
and [regenerating the bundled defaults](../runbooks/regenerate-runtimes-bundled-defaults.md).

## Cache-strategy-as-layer

See [cache-strategy-as-layer](../decisions/cache-strategy-as-layer.md) —
the package's signature DX and the shape most worth not breaking.

## Design decisions

- [Provenance lives in the engine state](../decisions/runtimes-provenance-in-engine-state.md)
- [The Node schedule is keyed by release line, not by major](../decisions/runtimes-node-schedule-by-release-line.md)
- [Concurrency-safe index](../decisions/runtimes-concurrency-safe-index.md)
- [Wall-clock time via Clock](../decisions/runtimes-wall-clock-via-clock.md)
- [The error ladder](../decisions/runtimes-error-ladder.md)
- [Config, not process.env](../decisions/runtimes-config-not-process-env.md)
- [GitHubClient is honestly scoped](../decisions/runtimes-githubclient-honestly-scoped.md)

## Observability

Named `Effect.fn` spans on each service's public fallible methods,
uniformly, with span annotations carrying stable identifiers only — no
payloads, no tokens. Warnings fire on the auto strategy's snapshot
fallback and on ambiguous credentials; nothing else logs. No metrics, no
OTel import — telemetry-agnostic.

## Hardening

The engine consumes untrusted JSON from three network feeds, with no
recursion over that input, so the depth-guard family does not apply. What
does apply, all of it about a remote server driving a local loop:
malformed feed payloads fail typed, never as a defect; pagination is
bounded by a hard page ceiling in `internal/limits.ts` above whatever the
caller asks for; numeric bounds are integer-guarded and die as defects
(`Number.isInteger` explicitly, never a bare `< 1`, since every relational
comparison against `NaN` is `false`); a server-supplied `retry-after` is
capped before it becomes a sleep, and a negative value is discarded in
favour of the exponential schedule; and a `403` is classified from status
and headers — the remaining-quota header for the primary rate limit,
`retry-after` for the secondary — never from body-message inspection,
so a `403` with neither stays an unretried transport error and a `429` is
definitionally a rate limit.

## Testing

Suites in `__test__/`, organized by seam: the fetch reference is a
`Context.Reference`, so a group runs the **real** HTTP stack against
canned responses, exercising request construction, status mapping and
schema decoding; `Layer.mock` stands in for the GitHub client in resolver
tests that do not care about transport; a swapped `ConfigProvider` drives
the auth precedence tests; and `TestClock` drives the rate-limit retry
delays. Deno has no suite of its own — it and Bun share one builder, so a
separate suite would re-test one code path.

The mutation-prone edges pinned at the seam where they can silently
collapse: provenance per strategy, an invalid range against a no-match,
the dotted `0.x` schedule lines at a reference date where the lines
disagree, an unresolvable requested default against an absent one, and
the `403` classification asserted on call **count** with `retry-after`
asserted on **timing**. Where an error is the claim, the assertion is on
its type — a raw transport error leaking through unwrapped is exactly
what the freshness error exists to catch.

## Build

`savvy.build.ts` carries the narrow `_base` suppression per
[the API-Extractor class-factories gotcha](../gotchas/api-extractor-forgotten-export-on-class-factories.md). Gate:
a cold `pnpm build --filter @effected/runtimes` produces a zero-warning
`dist/prod/issues.json` whose suppressed bucket holds only synthesized
class-factory `_base` symbols.
