# @effected/runtimes

Resolve semver-compatible Node.js, Bun and Deno versions from the live release feeds, with a bundled offline snapshot as a fallback. Twelfth migration, ported from the v3 `runtime-resolver` repo — which is also one of the five applications that define the release gate, so this package *is* that repo's business logic.

Three resolver services (`NodeResolver`, `BunResolver`, `DenoResolver`), each in three cache strategies, over one parameterized internal engine. The binary lives next door in `@effected/runtime-resolver-cli` and is not this package's problem.

**Design doc:** `@../../.claude/design/effected/packages/runtimes.md` — load before changing the strategies, the error ladder or the release index.

## Tier: boundary

`peerDependencies` is `effect` alone; `dependencies` is `@effected/semver` (`workspace:*`) and nothing else. **No external runtime dependency, and it must stay that way** — that is the whole reason the CLI is a separate package.

IO goes through `HttpClient` from `effect/unstable/http`, which arrives via the `R` channel; the consumer provides `FetchHttpClient.layer` at the edge, and that layer has no requirements of its own. `layerOffline` requires nothing at all.

**Octokit is gone.** `octokit` + `@octokit/auth-app` were the v3 library's entire runtime-dependency weight, funding exactly two REST GETs. R1 forbids them here outright. The seam they abstracted is now `FetchHttpClient.Fetch`, a `Context.Reference<typeof globalThis.fetch>` a test overrides with a fake `fetch`.

**GitHub App auth is deliberately not ported.** JWT signing plus installation-token exchange would mean a runtime dependency. `GitHubAuth` is a pluggable service with three in-package layers (anonymous, token, `layerConfig`); a consumer wanting App auth supplies their own `Layer<GitHubAuth>`. The v3 CLI's `--app-*` flags went with it. Recorded deviation — do not "fix" it by adding a dependency.

## Cache-strategy-as-layer

The package's signature DX idea, and the shape most worth not breaking. Each resolver exposes three layer **constants**:

- `layer` — auto: fetch live, fall back to the bundled snapshot **and say so**.
- `layerFresh` — live data or a typed `FreshnessError`.
- `layerOffline` — the snapshot. No IO, no failure, no requirements.

`internal/strategy.ts` is one function per strategy taking a loader, and each is **typed exactly**. That precision is the point: a single function switching on a strategy kind would union all three error channels together and force `layerOffline` to advertise a failure it cannot have.

The requirement channels differ, and it is not an accident: **Node needs only `HttpClient`** (nodejs.org's dist index and the `schedule.json` on `raw.githubusercontent.com` are both unauthenticated), while **Bun and Deno need `GitHubClient`** (authenticated REST). So `NodeResolver` works with zero GitHub credentials. `internal/githubRuntime.ts` is the layer builder those two share — Bun and Deno are the same resolver pointed at a different repository, which v3 expressed as six layers differing by a string.

## Invariants

- **Provenance is honest.** `source` is state on the release index, set by whichever strategy populated it (`"api"` live, `"cache"` snapshot, including the auto fallback), and the auto fallback additionally logs a warning. v3 advertised this field as a headline feature and hardcoded it to `"api"` in all three resolvers, so a stale snapshot served after a silent network failure was indistinguishable from a live answer. Do not let `source` become a constant again.
- **The Node schedule is keyed by release *line*, not by major.** `nodejs/Release` publishes `v0.8`, `v0.10` and `v0.12` as three distinct lines, and `Number.parseInt` maps all three to major `0`. A major-keyed entry collapses them onto whichever the iteration order yielded first. `NodeScheduleEntry` carries a `line` (`"20"`, or `"0.10"`), and asking for the bare major `0` honestly returns `None`. A fixture of `v20`/`v21`/`v22` *structurally cannot* catch a regression here — the fixtures carry the dotted lines on purpose.
- **An invalid range is an `InvalidRangeError`, not "no versions found".** v3 `catchAll`ed a filter failure into an empty array, so a typo in a range reached the user as a not-found. `InvalidRangeError` is `@effected/semver`'s and is imported from there — the no-barrel rule forbids re-exporting a dependency's surface.
- **An unresolvable `defaultVersion` fails; an absent one falls back.** Different questions. Because Node alone falls back to the LTS pick when no default was requested, silently omitting an unmatched default would hand the caller LTS as though they had asked for it. It is an `UnresolvableDefaultError`.
- **`NoMatchingVersionError`, never `VersionNotFoundError`.** `@effected/semver` already exports a `VersionNotFoundError` with that `_tag`, for a different condition, and both meet in this package's error channel. Two classes sharing a `_tag` break `catchTag` routing.
- **`VersionCache` from `@effected/semver` is not used.** It is a singleton `Context.Service` and this package needs three independent indices live at once. `SemVer` and `Range` are used directly.
- **The domain model holds no `Ref`.** Phase is a function of `(release, schedule, now)`, with the schedule owned by the release index. v3 threaded a shared mutable `Ref<NodeSchedule>` through every immutable `NodeRelease`.
- **Wall-clock time comes from `Clock`** (`DateTime.now`), so `TestClock` drives phase logic. No `new Date()`.

## Hardening

No parser, no recursion — the depth-guard family has no surface here. What does apply, all of it about a remote server driving a local loop:

- **Pagination is bounded.** v3 defaulted `maxPages` to `Number.POSITIVE_INFINITY`. See `internal/limits.ts`; there is a hard page ceiling above whatever the caller asks for.
- **Numeric bounds are integer-guarded and die.** `!Number.isInteger(n) || n < 1`, never a bare `n < 1` — every relational comparison against `NaN` is `false`. These are developer wiring errors, so they are **defects**, not typed failures.
- **A server-supplied `retry-after` is bounded before it becomes a sleep.** It is honored (guessing a backoff against a header GitHub actually sent is both ruder and less effective), which makes it untrusted input on a control path: it is capped, and a negative value is discarded in favour of the exponential schedule.
- **A `403` is classified, not assumed.** GitHub returns `403` for an exhausted rate limit *and* for permission failures. Classification uses `x-ratelimit-remaining: 0` (primary) and `retry-after` (secondary); a `403` with neither stays a `NetworkError` and is **not retried**. Body-message sniffing is deliberately not used.
- **Malformed feed payloads fail typed** as `ResponseParseError`, never as a defect.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` — never `expect`. Suite-boundary `layer(...)`, never a per-test `Effect.provide` (which is exactly what the v3 suite did).

The seams: `FetchHttpClient.Fetch` for canned HTTP responses (this exercises the real request construction, status mapping and schema decoding — the v3 Octokit stub bypassed all three), `Layer.mock(GitHubClient, {...})` for resolver tests that do not care about transport, a swapped `ConfigProvider` for auth precedence, and `TestClock` for the rate-limit retries.

Two assertions that look fine and are not: `assert.isTrue(exit._tag === "Failure")` on a `layerFresh` test stays green when a raw `NetworkError` leaks through, which is precisely what `FreshnessError` exists to wrap — assert the error *type*. And a retry test that asserts only "it eventually retried" passes whether the delay was the server's, the exponential one, or a negative value collapsed to zero — advance the clock to just short of the expected delay and assert the retry has **not** fired yet.

```bash
pnpm vitest run packages/runtimes     # from the repo root
pnpm build --filter @effected/runtimes
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
