---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../roadmap.md
  - semver.md
  - git.md
---

# @effected/runtimes design

## Overview

`@effected/runtimes` resolves semver-compatible versions of Node.js, Bun and Deno from live release feeds, with a bundled offline snapshot as a fallback. Three resolver services, three cache strategies each, over one parameterized internal engine. **Boundary tier.**

The `runtime-resolver` **binary is not part of the kit** — it ships from the external `runtime-resolver` repo against the published `@effected/runtimes`. Keeping the CLI in a different repo is what keeps `@effect/platform-node` (the integrated-tier dependency a CLI needs) out of this library's consumers; the library reaches the five gate applications, the binary does not.

## Tier and dependencies

IO through `effect`-core abstractions only (`HttpClient`); the consumer provides the platform layer at the edge. No external runtime dependency.

- `peerDependencies`: `effect`.
- `dependencies`: `@effected/semver` (`workspace:*`) — all version math.
- `prepare`: `turbo run build:dev` (required by the `workspace:*` edge — see [package-setup.md](../package-setup.md#cross-package-build-dependencies)).

The version math is [@effected/semver](semver.md)'s `SemVer` and `Range` used directly (`Range.test`, `SemVer.compare`), **not** its `VersionCache` service: `VersionCache` is a singleton `Context.Service`, and the resolver needs three independent indices (Node, Bun, Deno) live at once, which a singleton cannot provide without three tags.

## HTTP over core, no Octokit

All network access goes through `HttpClient` from `effect/unstable/http`, with the consumer providing `FetchHttpClient.layer` at the edge. `FetchHttpClient.layer` is `Layer<HttpClient>` with **no** requirements of its own, so providing the platform layer costs a consumer one import from `effect`. There is no `octokit` / `@octokit/auth-app` dependency — the two REST GETs the library needs (`/repos/{o}/{r}/tags`, `/repos/{o}/{r}/releases`) go straight through `HttpClient`, which R1 permits and Octokit would not.

**GitHub App auth is a pluggable seam, not a built-in.** JWT signing plus installation-token exchange would put a runtime dependency in a tier-2 package. Instead `GitHubAuth` is a service whose shape is "produce request headers," with three layers in-package (`anonymous`, `token`, `layerConfig`); App auth is reachable by a consumer supplying their own `Layer<GitHubAuth>`. Nothing in the five consuming applications needs App auth today.

This package and [@effected/git](git.md) independently drew the same conclusion about core: **core declares service abstractions it implements for no runtime.** Anything reaching for a subprocess, terminal or CLI framework needs a platform package, and a library that reaches for one becomes tier 3 for its consumers. That is why the CLI is external and why git owns a `ChildProcessSpawner` seam.

## Module layout

```text
src/
  index.ts              # public surface, re-exports only
  ResolvedVersions.ts   # Runtime / Source / Increments literals; ResolvedVersions class;
                        #   NoMatchingVersionError; FreshnessError
  GitHub.ts             # AuthenticationError, RateLimitError, NetworkError, ResponseParseError;
                        #   GitHubAuth service + layers (anonymous / token / layerConfig);
                        #   GitHubTag, GitHubRelease schemas; GitHubClient service + layers
  NodeSchedule.ts       # NodePhase literal; NodeScheduleEntry; NodeSchedule class + phaseFor;
                        #   NodeScheduleData, NodeReleaseLine, isLtsPhase, nodeReleaseLine,
                        #   InvalidScheduleDateError
  NodeRelease.ts        # NodeRelease class (version / npm / date)
  NodeResolver.ts       # NodeResolverOptions schema; NodeResolver service + 3 strategy layers
  BunResolver.ts        # BunRelease class; BunResolverOptions; BunResolver + 3 strategy layers
  DenoResolver.ts       # DenoRelease class; DenoResolverOptions; DenoResolver + 3 strategy layers
  internal/
    http.ts             # getJson over HttpClient; status -> typed error ladder; rate-limit backoff
    releaseIndex.ts     # generic Ref-backed index over releases + provenance
    strategy.ts         # auto / fresh / offline construction, parameterized once
    feeds.ts            # the upstream feeds and raw-record -> domain-release transforms
    githubRuntime.ts    # the layer builder Bun and Deno share (same resolver, different repo)
    resolve.ts          # the filter / group / rank / package pipeline, written once
    limits.ts           # pagination and payload bounds
    types.ts            # shared internal types
    defaults/
      node.ts bun.ts deno.ts   # generated offline snapshots
__test__/
```

The strategy collapse is the layout's centerpiece: `internal/strategy.ts` is parameterized once, so the three public resolver files expose the strategies as named layer constants rather than each owning a hand-written cache-and-fetcher stack. `githubRuntime.ts` is the shared Bun/Deno builder — they are the same resolver pointed at a different repository (`oven-sh` vs `denoland`) — and `resolve.ts` is the single filter/group/rank/package pipeline. `NodeRelease.ts` and `NodeSchedule.ts` stay split for Node alone because the schedule is a separate concept with its own lifecycle model and Node's release carries an extra `npm` field.

## Design decisions

### Provenance lives in the engine state

`internal/releaseIndex.ts` holds a `Ref<{ releases, source }>`; whichever strategy populates it sets `source` at load time — `"api"` for a live fetch, `"cache"` for the bundled snapshot, including the Auto strategy's fallback path. Resolvers read it. The Auto strategy additionally `Effect.logWarning`s on fallback, so serving a stale snapshot is never silent.

### Node schedule keyed by release line, not by major

`NodeRelease` is a clean `Schema.Class`:

```ts
export class NodeRelease extends Schema.Class<NodeRelease>("NodeRelease")({
  version: SemVer,
  npm: SemVer,
  date: Schema.DateTimeUtc,
}) {}
```

Phase is a function of `(release, schedule, now)`, with the schedule owned by the release index, not the model. `NodeSchedule.phaseFor(version, now)` takes an explicit reference date, so phase logic is testable without stubbing a `Date`. `Schema.DateTimeUtcFromString` decodes the raw feeds' date strings.

The schedule is **keyed by release line, not by major**. `nodejs/Release` publishes `v0.8`, `v0.10` and `v0.12` as three distinct lines with their own start and end dates, all of which `Number.parseInt` maps to major `0`; keying by major would collapse them onto whichever `Object.entries` yields first. `NodeScheduleEntry` carries a `line` (`"20"`, or `"0.10"`), `phaseFor` / `entryFor` take a version rather than a bare major, and the public `nodeReleaseLine({ major, minor })` exposes the mapping. Asking for the bare major `0` returns `None`. A schedule feed carrying an undecodable date fails typed (`InvalidScheduleDateError`) rather than dying.

### Concurrency-safe index

The release index is `Ref`-backed, and `load` is a single atomic `Ref.set`. An index inconsistency (a version present in the index but absent from its lookup map) is a programmer error and stays an `Effect.die` defect.

### Error ladder

Six `Schema.TaggedErrorClass` classes. No error carries a free-text `message` field — that would duplicate what the structured fields encode.

| error | fields | audience |
| --- | --- | --- |
| `NoMatchingVersionError` | `runtime`, `constraint`, `phases?` | calling code (`_tag` branch) + end user |
| `UnresolvableDefaultError` | `runtime`, `defaultVersion` | end user (you named a default that does not exist) |
| `FreshnessError` | `runtime`, `cause: Schema.Defect()` | end user (the fresh strategy could not reach the network) |
| `AuthenticationError` | `method` | end user (fix your credentials) |
| `RateLimitError` | `retryAfter?`, `limit`, `remaining` | calling code (`retryAfter` drives the retry schedule) |
| `NetworkError` | `url`, `status?`, `cause: Schema.Defect()` | operator |
| `ResponseParseError` | `source`, `cause: Schema.Defect()` | operator — a feed changed shape |

Three distinctions the pipeline must not collapse:

- **An invalid semver range surfaces as `InvalidRangeError`, not `NoMatchingVersionError`.** The resolver error channel is `InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError`, where `InvalidRangeError` is [@effected/semver](semver.md)'s (consumers import it from there — the no-barrel rule forbids re-exporting a dependency's surface). Swallowing a range failure into an empty result would report a typo as "no versions found."
- **An unresolvable `defaultVersion` fails (`UnresolvableDefaultError`); an absent one falls back.** `default` is an `optionalKey`, and Node alone falls back to the LTS pick when no default was requested. A caller who names a version that does not exist gets a real error rather than LTS handed to them as though they had asked for it.
- **`AuthenticationError.method` is passed down, not assumed.** `mapHttpFailure` takes the auth mode the caller actually used, so the `"anonymous"` arm is reachable and the unauthenticated nodejs.org feeds are not mislabelled as token rejections.

The "no versions matched" error is `NoMatchingVersionError`, not `VersionNotFoundError`, because [@effected/semver](semver.md) already exports a `VersionNotFoundError` with that `_tag` for a different condition. Two classes sharing a `_tag` in one channel breaks `catchTag` routing, and both meet in the resolver's channel.

### Config, not process.env

`GitHubAuth.layerConfig` uses `Config` with the precedence `GITHUB_PERSONAL_ACCESS_TOKEN` > `GITHUB_TOKEN` > unauthenticated, warns on ambiguity, is testable by swapping a `ConfigProvider`, and holds the token `Redacted`.

### GitHubClient is honestly scoped

The JSON-over-HTTP machinery lives in `internal/http.ts`. The Node dist-index and schedule fetchers use it **without** auth headers; `GitHubClient` keeps only the two authenticated REST list operations. `GitHub.ts` owns the four HTTP errors — one concept (typed HTTP transport failure) that the nodejs.org fetchers reuse rather than minting a parallel ladder.

### Wall-clock time via Clock

Every default reference time is `DateTime.now` (Clock-derived), so `TestClock` drives phase logic without stubbing a `Date`.

### Options are schemas

`NodeResolverOptions` / `BunResolverOptions` / `DenoResolverOptions` are `Schema.Struct`s with `Schema.optionalKey` fields and `Schema.Literals` for `phases` / `increments`.

## Service and layer shapes

```ts
class NodeResolver extends Context.Service<NodeResolver, {
  readonly resolve: (options?: NodeResolverOptions) =>
    Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError>;
}>()("@effected/runtimes/NodeResolver") {
  static readonly layer: Layer.Layer<NodeResolver, never, HttpClient>;        // auto
  static readonly layerFresh: Layer.Layer<NodeResolver, FreshnessError, HttpClient>;
  static readonly layerOffline: Layer.Layer<NodeResolver>;                    // no requirements
}
```

Cache-strategy-as-layer — the package's signature DX — is three named layer **constants** per resolver (bound to constants, per the memoization discipline). `layer` is the Auto strategy.

The requirement channels fall out of the data sources: **Node needs only `HttpClient`** (nodejs.org's dist index and `raw.githubusercontent.com`'s `schedule.json` are unauthenticated), while **Bun and Deno need `GitHubClient`** (authenticated REST). So `NodeResolver` works with zero GitHub credentials, and `GitHubAuth` is a dependency only of the two GitHub-backed resolvers. `layerOffline` requires nothing.

`GitHub.ts` exports `GitHubClient.layerDefault` = `GitHubClient.layer` provided with `GitHubAuth.layerConfig` + `FetchHttpClient.layer`, so the common wiring is one import; the un-provided `GitHubClient.layer` stays exported for consumers supplying their own auth or HTTP client.

## Observability

Named `Effect.fn` spans on each service's public fallible methods, uniformly: `"NodeResolver.resolve"`, `"BunResolver.resolve"`, `"DenoResolver.resolve"`, `"GitHubClient.listTags"`, `"GitHubClient.listReleases"`. `Effect.annotateCurrentSpan({ runtime, range })` carries stable identifiers, no payloads, no tokens. `Effect.logWarning` on the Auto strategy's snapshot fallback and on ambiguous GitHub credentials; no other logging. No metrics, no OTel import — telemetry-agnostic.

## Hardening

The engine consumes untrusted JSON from three network feeds. There is no recursion over that input, so the depth-guard family does not apply. What does:

- **Malformed feed payloads fail typed** (`ResponseParseError`), never as a defect. `internal/http.ts` decodes with `Schema.decodeUnknownEffect` and maps `SchemaError` at the boundary.
- **Pagination is bounded.** `internal/limits.ts` holds a default page cap, replacing an unbounded loop driven by a remote server's paging.
- **Numeric bounds are integer-guarded.** `perPage` / `pages` are guarded with `!Number.isInteger(n) || n < 1` and a **defect** — developer wiring, not data.
- **A server-supplied `retry-after` is bounded before it becomes a sleep.** It is honored as the retry delay, capped at 60s, and a negative value is discarded in favour of the exponential schedule. The rate-limit backoff (`internal/http.ts`) uses `Schedule.exponential` under `Schedule.passthrough` with `Schedule.modifyDelay` reading the failure's `retryAfter` from the passed-through `output`.
- **A `403` is classified, not assumed.** GitHub returns `403` for an exhausted rate limit *and* for permission and resource failures. Classification uses the documented signals — `x-ratelimit-remaining: 0` for the primary limit, `retry-after` for the secondary — and a `403` with neither stays a `NetworkError` carrying the status, so it is not retried. A `429` is definitionally a rate limit. Classification is from status and headers, never body-message inspection.

## Testing

`@effect/vitest` throughout; `it.effect` the default; `assert.*`, never `expect`; tests in `__test__/`, organized by seam.

Suite-boundary seams:

- **`FetchHttpClient.Fetch`** — a `Context.Reference<typeof globalThis.fetch>`. A `layer(...)` group provides `Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch)(fakeFetch))`, so the whole HTTP stack runs against canned responses, exercising real request construction, status mapping and schema decoding.
- **`Layer.mock(GitHubClient, {...})`** for resolver tests that do not care about transport.
- **`ConfigProvider`** swapped at the boundary for `GitHubAuth.layerConfig` precedence tests.
- **`TestClock`** for Node phase logic (mostly clock-free via the explicit `phaseFor` reference date) and for the rate-limit retry delays.

`DenoResolver` has no suite of its own — it and `BunResolver` are the same `githubRuntime.ts` builder, so a separate suite would re-test one code path. `ResolvedVersions`, `NodeRelease` and the release index are exercised through the resolver suites that own them.

Edges the suite pins (mutate-the-edges discipline):

- The Auto fallback sets `source: "cache"` **and** the live path sets `"api"`.
- An invalid range surfaces `InvalidRangeError`, not `NoMatchingVersionError`.
- `increments: "minor"` groups by minor, not major.
- A phase filter excluding every release yields `NoMatchingVersionError`, not an empty success.
- **The dotted `0.x` lines**: a schedule fixture carrying `v0.8` / `v0.10` / `v0.12` with real dates, asserted at a reference date where the lines disagree (June 2015: `v0.8` dead, `v0.12` current), pinned at the `NodeResolver` seam as well as on `NodeSchedule`.
- An unresolvable `defaultVersion` fails while an absent one falls back to LTS — both halves.
- A `403` with quota remaining is a `NetworkError` and is not retried, while a `403` with `x-ratelimit-remaining: 0` is — assert the call *count*.
- The `retry-after` is honored, capped and non-negative — assert the *timing* (advance the clock to just short of the expected delay and assert the retry has not fired).
- `layerFresh` failures assert the error *type*, not merely that an exit failed — a `NetworkError` leaking through unwrapped is exactly what `FreshnessError` exists to catch.

## Build

`savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Gate: a cold `pnpm build --filter @effected/runtimes` produces a zero-warning `dist/prod/issues.json` whose suppressed bucket holds only synthesized class-factory `_base` symbols.
