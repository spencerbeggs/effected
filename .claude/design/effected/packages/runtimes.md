---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-25
last-synced: 2026-09-02
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../roadmap.md
  - semver.md
  - git.md
  - spdx.md
---

# @effected/runtimes design

## Overview

`@effected/runtimes` resolves semver-compatible versions of Node.js, Bun and Deno from live release feeds, with a bundled offline snapshot as a fallback. Three resolver services, three cache strategies each, over one parameterized internal engine. **Boundary tier.**

**The library and its CLI live in different repositories, deliberately.** A `runtime-resolver` binary ships from the external `runtime-resolver` repo against the published `@effected/runtimes`; nothing in this workspace builds it. A CLI needs `@effect/platform-node`, which is an integrated-tier dependency, and keeping the binary out is what keeps that dependency out of this library's consumers. The library reaches the consuming applications; the binary does not.

## Tier and dependencies

IO through `effect`-core abstractions only; the consumer provides the platform layer at the edge. **No external runtime dependency, and it must stay that way** — that constraint is the reason for the repository split above.

`peerDependencies` is `effect`; `dependencies` is `@effected/semver` and nothing else, for all version math. That workspace edge requires the `prepare` script (see [package-setup.md](../package-setup.md#cross-package-build-dependencies)).

The version math uses [@effected/semver](semver.md)'s `SemVer` and `Range` **directly**, not its `VersionCache` service: `VersionCache` is a singleton `Context.Service`, and this package needs three independent indices — Node, Bun, Deno — live at once, which a singleton cannot provide without three tags.

## HTTP over core, no Octokit

All network access goes through `HttpClient` from `effect/unstable/http`, with the consumer providing a fetch-backed layer at the edge. That layer has no requirements of its own, so providing it costs a consumer one import from `effect`. There is **no octokit dependency**: the two authenticated REST reads the library needs go straight through `HttpClient`, which [R1](../effect-standards.md#dependency-policy) permits and Octokit would not.

**GitHub App auth is a pluggable seam, not a built-in.** JWT signing plus installation-token exchange would put a runtime dependency in a boundary-tier package. Instead `GitHubAuth` is a service whose shape is "produce request headers", with anonymous, token and config-driven layers in-package; App auth is reachable by a consumer supplying their own layer. Nothing in the consuming applications needs it today — this is a recorded deviation, not an oversight to "fix" by adding a dependency.

This package and [@effected/git](git.md) independently drew the same conclusion about core: **core declares service abstractions it implements for no runtime.** Anything reaching for a subprocess, terminal or CLI framework needs a platform package, and a library that reaches for one becomes tier 3 for its consumers. That is why the CLI is external and why git owns a spawner seam.

## Module layout

Public concept modules under `src/` — the three resolvers, plus `ResolvedVersions.ts`, `GitHub.ts`, `NodeSchedule.ts` and `NodeRelease.ts` — over an `internal/` engine. See `src/` for the exact split.

The **strategy collapse is the layout's centerpiece**: `internal/strategy.ts` is parameterized once, so the three public resolver files expose the strategies as named layer constants rather than each owning a hand-written cache-and-fetcher stack. `internal/githubRuntime.ts` is the shared Bun/Deno layer builder — the two are the same resolver pointed at a different repository — and `internal/resolve.ts` is the single filter/group/rank/package pipeline. `NodeRelease.ts` and `NodeSchedule.ts` stay split for Node alone, because the schedule is a separate concept with its own lifecycle model and Node's release carries an extra field.

`internal/defaults/` holds the three generated offline snapshots; see [Bundled defaults regeneration](#bundled-defaults-regeneration).

## Cache-strategy-as-layer

The package's signature DX, and the shape most worth not breaking. Each resolver exposes three layer **constants**, bound as constants per the memoization discipline:

- **`layer`** — auto: fetch live, fall back to the bundled snapshot **and say so**.
- **`layerFresh`** — live data or a typed failure.
- **`layerOffline`** — the snapshot. No IO, no requirements.

**Every layer is lazy, and that is load-bearing.** Acquisition performs no IO, so merging all three resolvers fetches nothing. The first `resolve` runs the population behind `internal/once.ts` — a semaphore-plus-`Ref` run-once gate chosen over `Effect.cached`, which memoizes the whole `Exit` and would let one transient failure, or an interrupted first resolve, poison the layer for its lifetime. Success is memoized, including the auto strategy's snapshot fallback; a **failed** fresh population is not, so the next resolve retries. Concurrent first resolves serialize on the gate and share one fetch. Do not replace the gate with `Effect.cached`, and do not move the fetch back into `Layer.effect`.

**The lazy timing moves the strategy's error channel out of the layer and into `resolve`.** All three layers have `E = never`; `resolve`'s error union carries the freshness failure on all three resolvers. That is the accepted cost of one `Context.Service` shape per resolver: `layer` and `layerOffline` advertise a failure they never produce. `internal/strategy.ts` still types each strategy exactly — only the fresh loader can fail, the auto loader falls back instead — and the requirement channels stay per-strategy, so the offline layer requires nothing.

The requirement channels differ, and it is not an accident: **Node needs only `HttpClient`**, because its dist index and release schedule are unauthenticated, while **Bun and Deno need `GitHubClient`** and its authenticated REST. So Node resolution works with zero GitHub credentials, and `GitHubAuth` is a dependency only of the two GitHub-backed resolvers. A pre-provided default client layer bundles the common auth-plus-HTTP wiring into one import, while the un-provided one stays exported for consumers supplying their own.

## Design decisions

### Provenance lives in the engine state

The release index holds a `Ref` of releases plus a source marker; whichever strategy populates it sets that marker at load time — live for a fetch, cache for the bundled snapshot, including the auto strategy's fallback path. Resolvers read it, and the auto strategy additionally logs a warning on fallback, so serving a stale snapshot is never silent. **Do not let the source marker become a constant** — an advertised provenance field hardcoded to "live" makes a stale answer indistinguishable from a fresh one.

### The Node schedule is keyed by release line, not by major

Node's release repository publishes `v0.8`, `v0.10` and `v0.12` as three distinct lines with their own start and end dates, all of which `Number.parseInt` maps to major `0`; keying by major would collapse them onto whichever iteration order yielded first. Schedule entries therefore carry a **line** (`"20"`, or `"0.10"`), phase lookups take a version rather than a bare major, and asking for the bare major `0` honestly returns `None`. A fixture of modern majors *structurally cannot* catch a regression here, which is why the fixtures carry the dotted lines on purpose. A schedule feed carrying an undecodable date fails typed rather than dying.

Phase is a function of `(release, schedule, now)`, with the schedule owned by the release index rather than the model — **the domain model holds no `Ref`**. The reference date is explicit, so phase logic is testable without stubbing a `Date`.

### Concurrency-safe index

The release index is `Ref`-backed and its load is a single atomic set. An index inconsistency — a version present in the index but absent from its lookup map — is a programmer error and stays a defect.

### Wall-clock time via Clock

Every default reference time is `DateTime.now`, so `TestClock` drives phase logic. No `new Date()`.

### Error ladder

The `Schema.TaggedError` classes live in `ResolvedVersions.ts` and `GitHub.ts`; see those files for the fields. No error carries a free-text `message` field — that would duplicate what the structured fields encode.

Four distinctions the pipeline must not collapse:

- **An invalid semver range surfaces as `InvalidRangeError`, not "no versions found".** That error is [@effected/semver](semver.md)'s, and consumers import it from there — the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) forbids re-exporting a dependency's surface. Swallowing a range failure into an empty result would report a typo as a not-found.
- **An unresolvable requested default fails; an absent one falls back.** These are different questions. Node alone falls back to the LTS pick when no default was requested, so silently omitting an unmatched default would hand the caller LTS as though they had asked for it.
- **The authentication method is passed down, not assumed**, so the anonymous arm is reachable and the unauthenticated feeds are not mislabelled as token rejections.
- **The no-match error is `NoMatchingVersionError`, never `VersionNotFoundError`.** [@effected/semver](semver.md) already exports a `VersionNotFoundError` with that `_tag` for a different condition, and both meet in this package's error channel. Two classes sharing a `_tag` break `catchTag` routing.

### Config, not process.env

The config-driven auth layer resolves its token through `Config` with a documented precedence between the two conventional environment variables, warns on ambiguity, is testable by swapping a `ConfigProvider`, and holds the token `Redacted`.

### GitHubClient is honestly scoped

The JSON-over-HTTP machinery lives in `internal/http.ts`, and the unauthenticated Node fetchers use it **without** auth headers; `GitHubClient` keeps only the authenticated REST list operations. `GitHub.ts` owns the HTTP error family — one concept, typed HTTP transport failure — which the unauthenticated fetchers reuse rather than minting a parallel ladder.

## Observability

Named `Effect.fn` spans on each service's public fallible methods, uniformly, with span annotations carrying stable identifiers — no payloads, no tokens. Warnings on the auto strategy's snapshot fallback and on ambiguous credentials; no other logging. No metrics, no OTel import — telemetry-agnostic.

## Hardening

The engine consumes untrusted JSON from three network feeds. There is no recursion over that input, so the depth-guard family does not apply. What does, all of it about a remote server driving a local loop:

- **Malformed feed payloads fail typed**, never as a defect; decoding happens at the boundary and schema failures are mapped there.
- **Pagination is bounded.** `internal/limits.ts` holds a hard page ceiling above whatever the caller asks for, replacing an unbounded loop driven by a remote server's paging.
- **Numeric bounds are integer-guarded and die.** The guard tests `Number.isInteger` explicitly, never a bare `< 1`, because every relational comparison against `NaN` is `false`. These are developer wiring errors, so they are **defects**.
- **A server-supplied `retry-after` is bounded before it becomes a sleep.** Honoring it is right — guessing a backoff against a header the server actually sent is both ruder and less effective — which makes it untrusted input on a control path: it is capped, and a negative value is discarded in favour of the exponential schedule.
- **A `403` is classified, not assumed.** GitHub returns `403` for an exhausted rate limit *and* for permission and resource failures. Classification uses the documented headers — the remaining-quota header for the primary limit, `retry-after` for the secondary — and a `403` with neither stays a transport error carrying the status, so it is not retried. A `429` is definitionally a rate limit. Classification is from status and headers, never body-message inspection.

## Bundled defaults regeneration

`lib/scripts/generate-defaults.ts` refreshes the three offline snapshots by fetching the live feeds through the package's own `internal/feeds.ts` — the same tag-strip, skip and parse rules the runtime resolvers use, single-sourced rather than reimplemented as a standalone client. It is a devDep script, not library surface: run by hand or by CI, never by the test suite, because it performs network IO.

It rewrites each snapshot by parsing the target file with `oxc-parser` and splicing only the byte span of each exported const's initializer, leaving headers, imports, TSDoc and type annotations untouched — the same technique [@effected/spdx](spdx.md#vendored-data-and-regeneration) uses for its vendored license data. Records are written in feed order; the script never re-sorts, so the generated diff reflects only what upstream actually changed.

Two invariants keep a bad fetch from corrupting the fallback the auto and offline strategies depend on:

- **Every record is filtered through the library's own parse before writing**, so a snapshot holds only resolvable versions — the same rule the resolvers apply to live data.
- **A zero-length result from any feed refuses the write outright.** A failed or truncated fetch must never overwrite a good snapshot with an empty one; the script dies loudly instead of committing silently wrong data.

`oxc-parser` is a **script-only devDependency**: nothing under `src/**` imports it, so the [dependency boundary](#tier-and-dependencies) is unchanged.

A scheduled workflow runs the generator daily. When it produces a diff, it writes a patch changeset and opens an auto-merging PR carrying both the regenerated snapshots and the changeset. Its build-and-test step runs with coverage disabled: this repo's vitest config enforces global coverage thresholds that a single-package subset run cannot meet, and that mismatch would abort the job for a reason unrelated to whether the regenerated data is correct.

## Testing

Suites in `__test__/`, organized by seam. The generator script has no suite entry and the suite must never invoke it — it performs live network IO. It is verified functionally instead, on the [spdx](spdx.md#vendored-data-and-regeneration) precedent: run it against the live feeds, confirm the diff touches only the snapshot bodies, that a second run is idempotent, and that the package builds and stays green on the regenerated data.

The suite-boundary seams that make the whole stack testable without network: the fetch reference is a `Context.Reference`, so a group can run the **real** HTTP stack against canned responses, exercising request construction, status mapping and schema decoding; `Layer.mock` stands in for the GitHub client in resolver tests that do not care about transport; a swapped `ConfigProvider` drives the auth precedence tests; and `TestClock` drives the rate-limit retry delays.

Deno has no suite of its own — it and Bun are the same shared builder, so a separate suite would re-test one code path.

The mutation-prone edges are the distinctions this doc calls load-bearing, and the suite pins each of them at the seam where it can silently collapse: provenance per strategy, an invalid range against a no-match, the dotted `0.x` lines at a reference date where the lines disagree, an unresolvable requested default against an absent one, and the `403` classification asserted on the call *count* with `retry-after` asserted on the *timing*. Where an error is the claim, the assertion is on its **type** — a raw transport error leaking through unwrapped is exactly what the freshness error exists to catch.

## Build

`savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Gate: a cold `pnpm build --filter @effected/runtimes` produces a zero-warning `dist/prod/issues.json` whose suppressed bucket holds only synthesized class-factory `_base` symbols.
