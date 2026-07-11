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
* `NodeSchedule` and `NodeRelease` — the Node.js lifecycle model. `schedule.phaseFor(major, now)` takes an explicit reference date, so every phase transition is testable without mocking time.
* Typed error channel: `NoMatchingVersionError`, `FreshnessError`, `AuthenticationError`, `RateLimitError` (carrying `retryAfter`), `NetworkError`, `ResponseParseError`, plus `InvalidRangeError` from `@effected/semver`.

The `source` field on a result is now honest. In v3 it was advertised as a headline feature and hardcoded to `"api"` by all three resolvers, so a snapshot served after a silent network failure was indistinguishable from a live answer. Provenance is now state on the release index, set by whichever strategy populated it, and the auto strategy logs a warning when it falls back.

An invalid semver range now surfaces as `InvalidRangeError` rather than being caught and reported as "no versions found".

Zero runtime dependencies beyond `@effected/semver`: `octokit` and `@octokit/auth-app` are gone, replaced by `HttpClient` from `effect` core, so consumers provide `FetchHttpClient.layer` (or any transport) at the edge. GitHub App authentication is not shipped; supply a custom `Layer<GitHubAuth>` that mints installation tokens if you need it.
