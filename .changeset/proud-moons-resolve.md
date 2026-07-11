---
"@effected/runtime-resolver": minor
---

## Features

Initial release of `@effected/runtime-resolver` — resolve semver-compatible Node.js, Bun and Deno versions from the upstream release feeds, with a bundled offline snapshot. A boundary-tier port of the v3 `runtime-resolver` library, redesigned rather than lifted.

Three resolver services, each available in three cache strategies as named layer constants:

```ts
import { NodeResolver, GitHubClient, BunResolver } from "@effected/runtime-resolver";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const program = Effect.gen(function* () {
  const node = yield* NodeResolver;
  const result = yield* node.resolve({ range: ">=20", phases: ["active-lts"] });
  return { latest: result.latest, source: result.source };
});

const layer = Layer.mergeAll(
  NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
);
```

* `NodeResolver`, `BunResolver`, `DenoResolver` — each exposing `layer` (fetch live, fall back to the bundled snapshot), `layerFresh` (live data or a typed `FreshnessError`) and `layerOffline` (the snapshot only, requiring nothing and performing no IO).
* `GitHubAuth` and `GitHubClient` — a GitHub REST client over `HttpClient` from `effect` core, with authentication as a pluggable service (`anonymous`, `token`, and an environment-detecting `layer` that prefers `GITHUB_PERSONAL_ACCESS_TOKEN` over `GITHUB_TOKEN`). `GitHubClient.layerDefault` wires the common case in one import.
* `NodeSchedule` and `NodeRelease` — the Node.js lifecycle model. `schedule.phaseFor(version, now)` takes an explicit reference date, so every phase transition is testable without mocking time.
* Typed error channel: `NoMatchingVersionError`, `UnresolvableDefaultError`, `FreshnessError`, `AuthenticationError`, `RateLimitError` (carrying `retryAfter`), `NetworkError`, `ResponseParseError`, plus `InvalidRangeError` from `@effected/semver`.

The `source` field on a result is now honest. In v3 it was advertised as a headline feature and hardcoded to `"api"` by all three resolvers, so a snapshot served after a silent network failure was indistinguishable from a live answer. Provenance is now state on the release index, set by whichever strategy populated it, and the auto strategy logs a warning when it falls back.

An invalid semver range now surfaces as `InvalidRangeError` rather than being caught and reported as "no versions found".

Node's release schedule is keyed by release **line**, not by major version. `nodejs/Release` publishes `v0.8`, `v0.10` and `v0.12` as three separate lines with their own start and end dates, and parsing those keys as integers maps all three onto the major `0` — so every `0.x` release resolved against whichever of them came first, and a `0.12` release was reported with `v0.8`'s dates. It is visible whenever a reference date makes the lines disagree: at June 2015, `v0.8` was already end-of-life while `v0.12` was current. `NodeScheduleEntry` now carries the line it came from, `phaseFor` and `entryFor` take a version rather than a bare major, and `nodeReleaseLine` exposes the mapping.

An explicit `defaultVersion` that matches nothing now fails with `UnresolvableDefaultError` instead of being silently discarded. Because Node falls back to the LTS pick when no default is requested, a caller who named a version that does not exist previously received the LTS version as though they had asked for it — the same class of silent degradation as the hardcoded `source` above. Omitting `defaultVersion` still falls back to LTS.

GitHub's `403` is now classified rather than assumed to be a rate limit. GitHub also returns `403` for permission and resource failures, which were being retried three times and then surfaced as a `RateLimitError` naming a quota that was never the problem. A `403` is treated as a rate limit only when it carries one of the signals GitHub documents — `x-ratelimit-remaining: 0`, or a `retry-after` — and otherwise leaves as a `NetworkError` carrying the status. A `429` remains a rate limit unconditionally. When GitHub does send a `retry-after`, it is now honored as the retry delay instead of being parsed and ignored in favour of a guessed exponential backoff; the wait is bounded so a misconfigured server cannot park a caller's fiber indefinitely.

`AuthenticationError.method` now reports how the request was actually authenticated. It was hardcoded to `"token"`, which made the `"anonymous"` arm unreachable and told operators to go and check a credential they had never supplied — the nodejs.org feeds are fetched with no credential at all. Both GitHub token environment variables are also read through `Config.redacted`, so a token is never materialized as a plain string.

Zero runtime dependencies beyond `@effected/semver`: `octokit` and `@octokit/auth-app` are gone, replaced by `HttpClient` from `effect` core, so consumers provide `FetchHttpClient.layer` (or any transport) at the edge. GitHub App authentication is not shipped; supply a custom `Layer<GitHubAuth>` that mints installation tokens if you need it.
