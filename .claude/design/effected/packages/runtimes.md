---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../roadmap.md
  - semver.md
---

# @effected/runtimes design

## Overview

**Merged** — migration #12, covering **two** packages. The v3 repo resolved semver-compatible versions of Node.js, Bun and Deno from live release feeds with a bundled offline snapshot, and shipped an `@effect/cli` binary from the same package. The port kept the domain concepts the [review](../../../reviews/runtime-resolver.md) praised — cache-strategy-as-layer, the vertical dependency graph, the typed HTTP error ladder, the deterministic Node lifecycle model — and split the binary out.

- **`@effected/runtimes`** — the library. Three resolver services, three cache strategies each, over one parameterized internal engine. **Boundary tier.**
- **`@effected/runtime-resolver-cli`** — the binary. **Integrated tier.**

runtime-resolver is one of the five consuming applications that define the release gate ([releases.md](../releases.md)), so "replacing its business logic" meant porting it: the v3 repo's library and CLI both live here now.

This document is the design as specified, with an [As built](#as-built-2026-07-11) section recording what the port actually landed. The sections below are accurate unless that section says otherwise.

## The runtimes rename

Renamed `@effected/runtime-resolver` → `@effected/runtimes` on 2026-07-12, the first half of the runtimes reshape recorded in [roadmap.md](../roadmap.md#2-the-runtimes-reshape). The rename happened before anything published, so it was free — the same reasoning that timed the ts-vfs and app renames. Service tag ids renamed with it (`@effected/runtime-resolver/NodeResolver` → `@effected/runtimes/NodeResolver`, and likewise for `BunResolver` and `DenoResolver`). The v3 source repo keeps the name `runtime-resolver` — only the merged package renamed. The CLI half of the reshape — deleting `@effected/runtime-resolver-cli` from the workspace — is deferred; the CLI package still exists under its original name and now depends on `@effected/runtimes` (`workspace:*`).

## The split, and why it is forced

[R1](../effect-standards.md#dependency-policy) says a tier-2 package takes no external runtime dependencies, and [R2](../effect-standards.md#dependency-policy) says tier-3 propagates. In v3, `@effect/cli` and `@effect/platform-node` are peers of the *whole* package while being used only by the `bin` entry — so every API-only consumer inherits them. That is exactly the shape R1 exists to forbid, and [package-inventory.md](../package-inventory.md) records the split as required rather than discretionary.

The monorepo does not use subpath exports (the config-file family precedent), so an optional dependency becomes a package boundary. The CLI therefore becomes its own package.

**Name: `@effected/runtime-resolver-cli`** (directory `packages/runtime-resolver-cli`). The naming precedent was the config-file family — `@effected/config-file-jsonc`, `-yaml`, `-toml`: the parent package name, hyphen, the qualifier that distinguishes the member. `runtime-resolver-cli` follows it exactly, sorts adjacent to its parent in `packages/`, and reads correctly as the npm binary's home. (Those three were [dissolved back into config-file](config-file.md#the-consolidation-2026-07-11) on 2026-07-11, which retires the precedent's original examples but not the convention — and note the reasoning does not carry over: the codecs merged because they are tree-shakeable alternatives with no dispatch, whereas this split exists to keep `@effect/platform-node` out of the library's consumers.)

## The `@effect/cli` verdict: dead on v4, and not needed

**`@effect/cli` has no v4 story and never will.** Verified against the registry: `@effect/cli@latest` is `0.75.2`, its dist-tags are `latest` and `snapshot` only (no `beta`), and its peer set is `effect@^3.21.2` + `@effect/platform@^0.96.1` + `@effect/printer{,-ansi}` — the v3 line. Nothing on the v4 train.

That is not a blocker, because **the CLI framework moved into `effect` core**. Core publishes `effect/unstable/cli`, exporting `Command`, `Flag`, `Argument`, `Param`, `Primitive`, `Prompt`, `HelpDoc`, `CliError`, `CliOutput` and `Completions`. `Command.run(command, { version })` returns `Effect<void, E | CliError, R | Command.Environment>`. The same merge happened to platform: `effect/unstable/http` ships `HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `HttpClientError` and `FetchHttpClient`.

So the port drops `@effect/cli` entirely and builds the binary on core. What keeps the CLI at tier 3 is the *runtime*, not the framework — `Command.Environment` (see `repos/effect-smol/packages/effect/src/unstable/cli/Command.ts`) is the union of `FileSystem`, `Path`, `Terminal`, `ChildProcessSpawner` and `Stdio`.

Core declares all five abstractions but implements **none of them for Node** — it ships `Path.layer`, `FileSystem.layerNoop` and `Stdio.layerTest`, and no more. The Node implementations (`NodeServices`, `NodeRuntime`, `NodeStdio`, `NodeTerminal`, `NodeFileSystem`, `NodeChildProcessSpawner`) live in `@effect/platform-node`, which is on the v4 train and peers on `effect` alone. That single non-core `@effect/*` runtime dependency is what makes the CLI integrated tier — and what the library must not pay for.

Both claims are re-verified against the **pinned** catalog beta and its matching `repos/effect-smol` subtree, not against whatever beta npm's `latest` points at. The original spec cited a *floating* `4.0.0-beta.97` back when the catalog carried a caret range; the catalogs now pin exact betas — and have since advanced to `4.0.0-beta.97` deliberately — so the installed version and the vendored subtree are the same thing by construction. The number is the same; how it is arrived at is the whole difference, and it is the only version worth citing.

**The split therefore survives the disappearance of its original cause.** It was justified by `@effect/cli` leaking onto library consumers; `@effect/cli` is gone, and `@effect/platform-node` leaks in precisely the same way. **Same R1 rule, different package.** [package-inventory.md](../package-inventory.md) predicted an `@effect/cli`-driven split; that prediction is falsified and the row is corrected — but the split it mandated was right for a reason it had not seen yet.

This is the most reusable thing the migration learned, and it generalizes past this package: **core declares service abstractions it does not implement for any runtime.** Anything reaching for one of the five — a CLI, a subprocess, a terminal — needs a platform package, and a library that reaches for one has just become tier 3 for its consumers. `@effected/workspaces` hit the identical wall from the other side and drew the identical conclusion: core ships a `ChildProcessSpawner` *contract* in `effect/unstable/process` and no Node implementation, so workspaces owns a `GitReader` seam rather than depending on `@effect/platform-node` ([workspaces.md](workspaces.md#gitreader--the-subprocess-seam)).

## Dropping Octokit

The v3 library's entire regular-dependency weight is `octokit` + `@octokit/auth-app`, funding exactly two REST GETs (`/repos/{o}/{r}/tags`, `/repos/{o}/{r}/releases`). R1 forbids them in a tier-2 package outright, and the review recommends dropping them. Both go.

The replacement is `HttpClient` from `effect/unstable/http` — core, so tier-2-legal — with the consumer providing `FetchHttpClient.layer` at the edge. `FetchHttpClient.layer` is `Layer<HttpClient>` with **no** requirements of its own (verified), so "provide the platform layer at the edge" costs a consumer one import from `effect`. The `OctokitInstance` structural port disappears with the dependency it abstracted; the seam it protected is now `FetchHttpClient.Fetch`, a `Context.Reference<typeof globalThis.fetch>` that a test overrides with a fake `fetch` (verified: a `Layer.succeed(FetchHttpClient.Fetch)(fake)` under `FetchHttpClient.layer` drives the whole client).

**GitHub App auth is deferred, not ported.** JWT signing plus installation-token exchange is what `@octokit/auth-app` buys, and keeping it would put a runtime dependency in a tier-2 package — the thing R1 forbids. Instead `GitHubAuth` becomes a **pluggable service** whose shape is "produce request headers", with three layers in-package (`anonymous`, `token`, `layerConfig`) and App auth reachable by a consumer supplying their own `Layer<GitHubAuth>`. This is the review's recommended option 1 and it is the first recorded deviation: the v3 CLI's `--app-id` / `--app-private-key` / `--app-installation-id` flags do not survive the port. They are re-addable behind a future `@effected/github` package or directly in the CLI (which is tier 3 and may take the dependency) if a consumer asks; nothing in the five consuming applications does today.

## Tier and dependencies

### `@effected/runtimes` — boundary

IO through `effect`-core abstractions only (`HttpClient`), consumer provides the platform layer at the edge. No external runtime dependency.

- `peerDependencies`: `effect` (`catalog:effect`).
- `dependencies`: `@effected/semver` (`workspace:*`) — all version math.
- `prepare`: `turbo run build:dev` (required by the `workspace:*` edge — see [package-setup.md](../package-setup.md#cross-package-build-dependencies)).

### `@effected/runtime-resolver-cli` — integrated

- `dependencies`: `effect` (`catalog:effect`), `@effect/platform-node` (`catalog:effect`), `@effected/runtimes` (`workspace:*`). A tool declares the full stack as regular dependencies (effect-standards, peer-dependency discipline).
- `bin`: `{ "runtime-resolver": "./src/bin.ts" }`.
- Tier 3 by R1; nothing depends on it, so R2 propagation is moot.

## Module layout

### `packages/runtimes`

```text
src/
  index.ts              # public surface, re-exports only
  ResolvedVersions.ts   # Runtime / Source / Increments literals; ResolvedVersions class;
                        #   NoMatchingVersionError; FreshnessError
  GitHub.ts             # AuthenticationError, RateLimitError, NetworkError, ResponseParseError;
                        #   GitHubAuth service + layers (anonymous / token / layerConfig);
                        #   GitHubTag, GitHubRelease schemas; GitHubClient service + layers
  NodeSchedule.ts       # NodePhase literal; NodeScheduleEntry; NodeSchedule class + phaseFor
  NodeRelease.ts        # NodeRelease class (version / npm / date)
  NodeResolver.ts       # NodeResolverOptions schema; NodeResolver service + 3 strategy layers
  BunResolver.ts        # BunRelease class; BunResolverOptions; BunResolver + 3 strategy layers
  DenoResolver.ts       # DenoRelease class; DenoResolverOptions; DenoResolver + 3 strategy layers
  internal/
    http.ts             # getJson over HttpClient; status -> typed error ladder; retryOnRateLimit
    releaseIndex.ts     # generic Ref-backed index over releases + provenance
    strategy.ts         # auto / fresh / offline construction, parameterized once
    semver.ts           # tryParseSemVer (Option-returning)
    limits.ts           # pagination and payload bounds
    defaults/
      node.ts bun.ts deno.ts   # generated snapshots (~6.8k lines)
__test__/
  ResolvedVersions.test.ts  GitHub.test.ts  NodeSchedule.test.ts  NodeRelease.test.ts
  NodeResolver.test.ts  BunResolver.test.ts  DenoResolver.test.ts  ReleaseIndex.test.ts
  hostile.test.ts
```

The v3 `layers/` directory held 23 files: strategy × runtime (9), release caches (3), resolvers (3), fetchers (4), auth (3), plus the generic cache. The Fresh layers for Bun and Deno differed by a repo name. All of it collapses into `internal/strategy.ts` parameterized once, with the three public resolver files exposing the strategies as named layer constants.

Two review open questions, decided:

- **`*Release.ts` files fold into their `*Resolver.ts` files for Bun and Deno**, whose releases are just `{ version, date }`. Node keeps `NodeRelease.ts` and `NodeSchedule.ts` split — the schedule is a genuinely separate concept with its own lifecycle model, and Node's release carries the extra `npm` field.
- **The Promise facade (`resolveNode` / `resolveBun` / `resolveDeno`) is dropped.** This is an Effect-first monorepo, and the non-Effect consumer that facade existed for is the CLI, which now has its own package and stays inside Effect end to end. What it embodied — a prebuilt default layer composition — survives as `GitHubClient.layerDefault` plus the resolvers' named strategy layers. Deviation recorded; re-addable as statics if a consumer asks.

### `packages/runtime-resolver-cli`

```text
src/
  index.ts        # re-exports the command for embedding/testing
  Cli.ts          # Command definition (flags + handler) on effect/unstable/cli
  CliResponse.ts  # the JSON envelope schemas (ok / results / per-runtime success|error)
  bin.ts          # #!/usr/bin/env node — NodeRuntime.runMain over Command.run
__test__/
  Cli.test.ts     # Command.runWith(argv) against stubbed resolver layers
```

`Command.runWith` takes an explicit `argv` array, so the CLI is testable without spawning a process — the v3 suite could not do this.

**A usage error is a failure, not a printed complaint.** Selecting no runtime, or passing an unrecognized `--node-phases` value, fails with `CliError.UserError` (from `effect/unstable/cli`), which `Command.run` and `NodeRuntime.runMain` already understand as exit code 1. Printing the complaint and returning successfully — the first cut — exits `0`, and a CI job gating on the exit status reads a typo as a pass. Failing also removes the sentinel that made the phase parsing awkward: `parsePhases` fails through the error channel instead of returning `Option.some(undefined)` for the caller to test against.

The distinction the tests must hold: a **usage** error fails the process, while a **resolution** that matches nothing is data — it exits `0` with `ok: false` in the envelope, because a caller asking "what Node versions match `>=999`?" got a real answer. Collapsing the two in either direction is the bug.

## What changes, concept by concept

### Provenance actually works

The v3 `source: "api" | "cache"` field is advertised as a headline feature and **hardcoded to `"api"` by all three resolvers**. The Auto layer knows whether it fell back, but that knowledge dies at the layer boundary.

The fix moves provenance into the engine's state. `internal/releaseIndex.ts` holds a `Ref<{ releases, source }>`; whichever strategy populates it sets `source` at load time (`"api"` for a live fetch, `"cache"` for the bundled snapshot, including the Auto strategy's fallback path). Resolvers read it. The Auto strategy additionally `Effect.logWarning`s on fallback — silently serving a stale snapshot labelled `"api"` is the current worst case, and a fallback a caller cannot see is the second worst.

### The `Ref<NodeSchedule>` leaves the domain model

`NodeRelease` in v3 is a plain class (not `Data.TaggedClass`, because the `Ref` breaks equality — the file apologizes for this) carrying a shared mutable `Ref<NodeSchedule>` so that `release.phase(now)` can consult the schedule. Mutable service state threaded through immutable domain values.

Phase becomes a function of `(release, schedule, now)`, with the schedule owned by the release index, not the model. `NodeRelease` becomes a clean `Schema.Class`:

```ts
export class NodeRelease extends Schema.Class<NodeRelease>("NodeRelease")({
  version: SemVer,
  npm: SemVer,
  date: Schema.DateTimeUtc,
}) {}
```

`Schema.DateTimeUtcFromString` is the codec used to decode the raw feeds' date strings (verified: it decodes `"2024-03-01"` to `DateTime.Utc`). The `NodeSchedule.phaseFor(version, now)` reference-date parameter — the review's favourite piece of testability in the package — is preserved.

**The schedule is keyed by release line, not by major.** The reference date survived the port; the key did not. `nodejs/Release` publishes `v0.8`, `v0.10` and `v0.12` as three distinct release lines with their own start and end dates, and `Number.parseInt` maps all three keys to the major `0`. Keying `NodeScheduleEntry` by major therefore collapsed them onto whichever `Object.entries` yielded first, so every `0.x` release was answered with `v0.8`'s schedule — `v0.8` was already end-of-life in June 2015 while `v0.12` was current, and both the bundled snapshot and the live feed carry all three. `NodeScheduleEntry` carries a `line` (`"20"`, or `"0.10"`), `phaseFor` / `entryFor` take a version rather than a bare major, and the public `nodeReleaseLine({ major, minor })` exposes the mapping. Asking for the bare major `0` now honestly returns `None` rather than some other `0.x` line's dates.

### Concurrency-safe index

`createRuntimeCache` in v3 uses a bare closure `Map` with a documented "load is not concurrency-safe" caveat. A comment is not a concurrency strategy: the index becomes `Ref`-backed, and `load` a single atomic `Ref.set`.

The index does **not** build on `@effected/semver`'s `VersionCache`, despite the v3 code doing so. `VersionCache` is a `Context.Service` — a singleton in the context — and the resolver needs three independent indices (Node, Bun, Deno) live at once, which a singleton service cannot provide without three tags. The index instead uses `SemVer` and `Range` directly (`Range.test`, `SemVer.compare`), which is all the version math it ever needed; `@effected/semver` stays a dependency for exactly those.

### Error ladder

Eight `Data.TaggedError` classes become six `Schema.TaggedErrorClass` classes. `InvalidInputError` and `CacheError` are **deleted** — both are exported from the v3 `index.ts` and constructed nowhere in `src/`. The free-text `message: string` field is dropped from every error: it duplicated what the structured fields already encode, which is the error-handling standard's "never collapse errors to strings" applied to the error's own payload.

| error | fields | audience |
| --- | --- | --- |
| `NoMatchingVersionError` | `runtime`, `constraint`, `phases?` | calling code (`_tag` branch) + end user |
| `UnresolvableDefaultError` | `runtime`, `defaultVersion` | end user (you named a default that does not exist) |
| `FreshnessError` | `runtime`, `cause: Schema.Defect()` | end user (the fresh strategy could not reach the network) |
| `AuthenticationError` | `method` | end user (fix your credentials) |
| `RateLimitError` | `retryAfter?`, `limit`, `remaining` | calling code (`retryAfter` drives the retry schedule) |
| `NetworkError` | `url`, `status?`, `cause: Schema.Defect()` | operator (logged/spanned) |
| `ResponseParseError` | `source`, `cause: Schema.Defect()` | operator — a feed changed shape |

**`InvalidRangeError` is surfaced, not swallowed.** The v3 resolvers `catchAll` a `cache.filter(range)` failure into an empty array, so an *invalid* semver range reaches the user as `VersionNotFoundError` ("no versions found") rather than as the range error it is. The resolver error channel becomes `InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError`, where `InvalidRangeError` is `@effected/semver`'s (verified: `Range.parse` fails with exactly that one error). Consumers import it from `@effected/semver` — the no-barrel rule forbids re-exporting a dependency's surface.

**An unresolvable `defaultVersion` fails; an absent one falls back.** These are different questions and the pipeline must not collapse them. `default` is an `optionalKey`, so a default range matching nothing could simply be omitted from the result — and because Node (alone) falls back to the LTS pick when no default was requested, omitting it hands the caller LTS as though they had asked for it. A caller who names a version that does not exist has made a mistake, and it reaches them as `UnresolvableDefaultError` rather than as a plausible-looking wrong answer. This is the same silent-degradation class as v3's hardcoded `source: "api"`; the fix is the same shape — carry the distinction instead of erasing it.

**`AuthenticationError.method` is passed down, not assumed.** `mapHttpFailure` takes the auth mode the caller actually used. Hardcoding `"token"` made the `"anonymous"` arm of the literal union unreachable, and mislabelled the nodejs.org feeds — which are fetched with no credential at all — as token rejections.

The "no versions matched" error is named **`NoMatchingVersionError`, not `VersionNotFoundError`**, because `@effected/semver` already exports a `VersionNotFoundError` with that `_tag`, for a different condition (a version absent from a cache). Two classes sharing a `_tag` in one error channel breaks `catchTag` routing — a real hazard, since both semver's errors and ours meet in the resolver's channel.

### Config, not `process.env`

`GitHubAutoAuth` reads `process.env` directly at layer construction, and constructs-then-provides another layer inside a layer to delegate to App auth. Both go. `GitHubAuth.layerConfig` uses `Config` with the same precedence policy (`GITHUB_PERSONAL_ACCESS_TOKEN` > `GITHUB_TOKEN` > unauthenticated) and the same ambiguity warning, and is testable by swapping a `ConfigProvider`. The token is held `Redacted`.

### `GitHubClient` is honestly scoped

The v3 `GitHubClient.getJson` uses raw global `fetch` with an ad-hoc `{ decode }` pseudo-schema parameter, and `NodeVersionFetcherLive` fetches *nodejs.org* through the "GitHub" client. The JSON-over-HTTP machinery moves to `internal/http.ts`, where the Node dist-index and schedule fetchers use it **without** auth headers, and `GitHubClient` keeps only the two authenticated REST list operations. `GitHub.ts` still owns the four HTTP errors: they are one concept (typed HTTP transport failure) and the nodejs.org fetchers reuse that ladder rather than minting a parallel one — the module is named for its dominant user, and the alternative (a public `Http.ts` whose only surface is four error classes) is the central-`errors/`-directory smell the module-per-concept layout exists to kill.

### Wall-clock time via `Clock`

`DateTime.unsafeMake(new Date())` is scattered through the v3 resolver and model code. Every default reference time becomes `DateTime.now` (Clock-derived), so `TestClock` drives phase logic without stubbing a `Date`.

### Options are schemas

`NodeResolverOptions` / `BunResolverOptions` / `DenoResolverOptions` become `Schema.Struct`s with `Schema.optionalKey` fields and `Schema.Literals` for `phases` / `increments`. The CLI decodes once instead of hand-validating phases and increments against string arrays and throwing bare `Error`s.

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

Cache-strategy-as-layer — the package's signature DX idea — survives as three named layer **constants** per resolver (bound to constants, per the memoization discipline). `layer` is the Auto strategy, because that is the default a caller wants.

The requirement channels fall out of the data sources and are worth stating: **Node needs only `HttpClient`** (nodejs.org's dist index and `raw.githubusercontent.com`'s `schedule.json` are both unauthenticated), while **Bun and Deno need `GitHubClient`** (authenticated REST). So `NodeResolver` works with zero GitHub credentials, and `GitHubAuth` is a dependency only of the two resolvers that actually talk to the GitHub API. `layerOffline` requires nothing at all in every case.

`GitHub.ts` exports a batteries-included `GitHubClient.layerDefault` = `GitHubClient.layer` provided with `GitHubAuth.layerConfig` + `FetchHttpClient.layer`, so the common wiring is one import; the un-provided `GitHubClient.layer` stays exported for consumers who want to supply their own auth or HTTP client.

## Observability

Pure boundary-only instrumentation, uniform across each service's public fallible methods:

- `Effect.fn("NodeResolver.resolve")`, `"BunResolver.resolve"`, `"DenoResolver.resolve"`, `"GitHubClient.listTags"`, `"GitHubClient.listReleases"`. Every public fallible method of a service is named, or none is.
- `Effect.annotateCurrentSpan({ runtime, range })` — stable identifiers, no payloads, no tokens.
- `Effect.logWarning` on the Auto strategy's fallback to the bundled snapshot, and on ambiguous GitHub credentials. No other logging.
- **No metrics.** A library meters nothing; the app meters its call. No OTel import anywhere — telemetry-agnostic per the observability standard.

The v3 package has zero `Effect.fn` and one `logWarning` in its entirety.

## Hardening

The engine consumes untrusted JSON from three network feeds. There is no recursion over that input — no parser, no tree walk — so the depth-guard family does not apply. What does:

- **Malformed feed payloads fail typed** (`ResponseParseError`), never as a defect. `internal/http.ts` decodes with `Schema.decodeUnknownEffect` and maps `SchemaError` to the domain error at the boundary.
- **Pagination is bounded.** The v3 `listTags` / `listReleases` default `maxPages` to `Number.POSITIVE_INFINITY` — an unbounded loop driven by a remote server's paging behaviour. `internal/limits.ts` holds a default page cap.
- **The numeric-bound guard.** `perPage` / `pages` are caller-supplied numbers; `if (n < 1)` admits both `NaN` and `2.5` (every relational comparison against `NaN` is `false`). They are guarded with `!Number.isInteger(n) || n < 1` and a **defect** — these are developer wiring errors, not data conditions, so they must not enter the typed channel (planning-pillar ruling, and the `hardening-a-parser-port` numeric-bound item).
- **`Effect.die` on index inconsistency stays a defect.** The v3 lookup-map invariant check is correct as-is: a version present in the index but absent from its lookup is a programmer error, not a business failure.
- **A server-supplied `retry-after` is bounded before it becomes a sleep.** The header is a number a remote server chose, and it is honored as the retry delay (guessing an exponential backoff against a `retry-after` GitHub actually sent is both ruder and less effective). That makes it untrusted input on a control path: it is capped at 60s, and a negative value is discarded in favour of the exponential schedule. Without the cap, one large header parks the caller's fiber for as long as the server likes; without the non-negative guard, a negative value collapses the backoff to a zero-delay hot retry.
- **A `403` is classified, not assumed.** GitHub returns `403` for an exhausted rate limit *and* for permission and resource failures. Treating the status alone as a rate limit retried the latter three times and then reported a `RateLimitError` naming a quota that was never the problem. The classification uses the signals GitHub documents — `x-ratelimit-remaining: 0` for the primary limit, `retry-after` for the secondary — and a `403` with neither leaves as a `NetworkError` carrying the status, so it is not retried. A `429` is definitionally a rate limit and needs no classification. Body-message inspection (`"You have exceeded a secondary rate limit"`) is deliberately **not** used: the transport classifies from status and headers before it touches the body, and the two header signals already cover both limit kinds.

## Testing

`@effect/vitest` throughout; `it.effect` the default; `assert.*` never `expect`; tests in `__test__/`.

The suite-boundary seams:

- **`FetchHttpClient.Fetch`** — a `Context.Reference<typeof globalThis.fetch>`. A `layer(...)` group provides `Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch)(fakeFetch))` and the whole HTTP stack runs against canned responses. This replaces the v3 `OctokitInstance` stub and is strictly better: it exercises the real request construction, status mapping and schema decoding, where the Octokit stub bypassed all three.
- **`Layer.mock(GitHubClient, {...})`** for resolver tests that do not care about transport.
- **`ConfigProvider`** swapped at the boundary for `GitHubAuth.layerConfig` precedence tests.
- **`TestClock`** for the Node phase logic — plus the `NodeSchedule.phaseFor(version, now)` explicit reference date, which makes most of it clock-free. `TestClock` is unavoidable for the rate-limit retries, whose delays are the thing under test.

The v3 tests are plain vitest + `Effect.runPromise` + a repeated `Effect.provide` in every test body — the anti-pattern the testing standard names. Coverage is broad, so the conversion is mechanical.

Edge cases the suite must actually pin (mutate-the-edges discipline): the Auto strategy's fallback sets `source: "cache"` **and** the live path sets `"api"`; an invalid range surfaces `InvalidRangeError` and not `NoMatchingVersionError`; `increments: "minor"` groups by minor and not by major; a phase filter that excludes every release yields `NoMatchingVersionError` rather than an empty success; and the rate-limit retry actually retries.

Four more, each of which shipped green and unpinned in the first cut and was only caught by review:

- **The dotted `0.x` lines.** A schedule fixture of `v20`/`v21`/`v22` *structurally cannot* catch a major-keyed collapse, because those majors are already distinct. The fixture must carry `v0.8`, `v0.10` and `v0.12` with their real dates, and assert at a reference date where the lines disagree (June 2015: `v0.8` dead, `v0.12` current). Pin it at the `NodeResolver` seam too, not just on `NodeSchedule` — the unit test says nothing about whether `NodeRelease.phase` asks the schedule the right question.
- **An unresolvable `defaultVersion` fails**, and an absent one still falls back to LTS. Both halves, or the fix reads as "always fail".
- **A `403` with quota remaining is a `NetworkError` and is not retried**, while a `403` with `x-ratelimit-remaining: 0` still is. Assert the call *count*, not just the error type.
- **The `retry-after` is honored, capped, and non-negative.** The trap here is a test that asserts only "it eventually retried": that passes whether the delay is the server's 30s, the 1s exponential, or a negative value collapsed to zero. The assertion has to pin the *timing* — advance the clock to just short of the expected delay and assert the retry has **not** fired yet.

An error-type assertion is not optional on the `layerFresh` tests. `assert.isTrue(exit._tag === "Failure")` stays green for a regression that fails with the wrong error entirely — including the raw `NetworkError` leaking through, which is exactly what `FreshnessError` exists to wrap.

## Deviations from the review, recorded

1. **GitHub App auth is dropped**, not made pluggable-with-an-optional-peer. An optional peer is still an external runtime dependency in a tier-2 package. `GitHubAuth` is a service a consumer can implement; the App-auth recipe is documented, not shipped. The CLI's three `--app-*` flags go with it.
2. **The Promise facade is dropped** (the review left this open).
3. **`VersionNotFoundError` is renamed `NoMatchingVersionError`** to avoid a `_tag` collision with `@effected/semver`.
4. **`VersionCache` from `@effected/semver` is not used** — it is a singleton `Context.Service` and the resolver needs three independent indices. `SemVer` and `Range` are used directly.
5. **`@effect/cli` is not used** — it has no v4 release. `effect/unstable/cli` replaces it.

## As built (2026-07-11)

Merged as two packages with **74 tests** across them, a clean typecheck and biome run, and both cold prod builds reporting zero warnings and zero errors with all 20 suppressed entries being synthesized class-factory `_base` symbols. Adding `@effect/platform-node` v4 to the CLI introduced **no new `pnpm peers check` warning** — and as of the pnpm 11.12.0 upgrade that check is clean outright, with no residual tooling warnings to discount it against.

### Beta.97 adaptation: `Schedule.modifyDelay` takes one metadata object

The `retryAfter`-honoring backoff in `internal/http.ts` (`rateLimitBackoff`) is the one place upstream churn reached this package. Beta.97 consolidated `Schedule`'s callback shape: **`modifyDelay` now receives a single metadata object `{ duration, output }`** rather than the old positional `(failure, delay)`. Under `Schedule.passthrough` the schedule's output *is* its input, so `output` is the `HttpFailure` — which is what lets the callback read the failure's `retryAfter` and substitute it for the computed `duration`:

```ts
Schedule.exponential("1 second").pipe(
  Schedule.setInputType<HttpFailure>(),
  Schedule.passthrough,
  Schedule.modifyDelay(({ duration, output: failure }) => /* retryAfter ?? duration */),
)
```

The *semantics* are unchanged — the header is still honored, still capped at 60s, still discarded when negative (see [Hardening](#hardening)). Only the destructuring moved. Worth recording because the `passthrough`/`output` relationship is non-obvious: nothing in the name `output` suggests "the failure", and reconstructing why it is one costs more than a sentence.

Everything above landed as designed. What differs is the internal decomposition, which went further than the sketch:

1. **`internal/` carries four modules the design did not name**, because the strategy collapse pulled more with it than expected. `feeds.ts` holds the upstream feeds and the raw-record→domain-release transforms (v3's four fetcher services with four `*Live` layers, which differ only in a URL and how a tag name is stripped). `githubRuntime.ts` is the layer builder Bun and Deno share — they are the same resolver pointed at a different repository, which v3 expressed as two release caches, two fetchers, two resolvers and six strategy layers whose only textual difference was `"oven-sh"` versus `"denoland"`. `resolve.ts` is the filter/group/rank/package pipeline, written **once** rather than v3's three drifted copies — only Node grouped by minor correctly and all three collapsed an invalid range into "no versions found", which is how that bug survived. `types.ts` holds shared types. The design's planned `internal/semver.ts` did not materialize; the `Option`-returning parse folded into the modules that needed it.
2. **The test files are organized by seam, not one-per-source-module.** `NodeResolver.test.ts`, `BunResolver.test.ts`, `GitHub.test.ts`, `NodeSchedule.test.ts` and `hostile.test.ts`. `DenoResolver` has no file of its own — it and `BunResolver` are the same `githubRuntime.ts` builder, so a separate suite would have re-tested one code path twice rather than pinning a second one. `ResolvedVersions`, `NodeRelease` and the release index are exercised through the resolver suites that own them.
3. **`NodeSchedule` grew a public surface the design did not sketch**: `NodeScheduleData`, `NodeReleaseLine`, `isLtsPhase`, `nodeReleaseLine` and an `InvalidScheduleDateError`. The release-line keying (the dotted-`0.x` fix) is what forced it — once a line is a first-class key rather than a parsed integer, the mapping from a version to its line has to be public, and a schedule feed carrying an undecodable date has to fail typed rather than die.
4. **The CLI's `--increments` uses `Flag.choice`**, which validates at parse time, so an invalid value never reaches the handler. `--node-phases` takes a comma-separated list, which `Flag.choice` cannot express, so it decodes through the same schema the library uses — the usage-error-is-a-failure rule above is what that buys.

The finding worth carrying forward is the [`@effect/cli` verdict](#the-effectcli-verdict-dead-on-v4-and-not-needed) and its generalization: core declares service abstractions it implements for no runtime, so reaching for one is what makes a package tier 3. Check `Command.Environment` before assuming a CLI is free.
