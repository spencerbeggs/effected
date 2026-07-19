# @effected/runtimes

[![npm](https://img.shields.io/npm/v/@effected%2Fruntimes?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/runtimes)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Resolve semver-compatible Node.js, Bun and Deno versions from the live release feeds, with a bundled offline snapshot as a fallback. Ask for `>=20` in the `active-lts` phase and get back every match, newest first, plus the LTS pick and whatever you nominated as the default. Node's lifecycle phases come from the real `nodejs/Release` schedule and are evaluated against the clock, so `current`, `active-lts`, `maintenance-lts` and `end-of-life` mean what they mean today rather than on the day the package was published.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/runtimes

Every answer carries an honest `source`. A resolver that fetches live data, silently fails, serves a snapshot and reports `source: "api"` is worse than one that never had a snapshot — you cannot tell a fresh answer from a stale one, and a CI job pinning its toolchain will happily install a version that was current last quarter. Here the field is set by whichever strategy actually populated the index: `"api"` when the feed answered, `"cache"` when the snapshot did, including when the automatic strategy fell back to it, and the fallback logs a warning on the way through.

The freshness policy is a layer, not a flag, and the types follow: `layerOffline` has no error channel and no requirements, because a snapshot read cannot fail and does no IO. `layerFresh` fails with `FreshnessError` and nothing else, because you chose it to say a snapshot is not an acceptable substitute. A single resolver switching on a strategy enum would union all three error channels together and force the offline layer to advertise a failure it cannot have.

There is no HTTP client in the dependency tree either. The v3 library carried Octokit and `@octokit/auth-app` to fund exactly two REST GETs; this one goes through `HttpClient` from `effect/unstable/http` and lets you supply the transport. `@effected/semver` is the only runtime dependency, and it is first-party.

## Install

```bash
npm install @effected/runtimes effect
```

```bash
pnpm add @effected/runtimes effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency. `@effected/semver` is a regular dependency and comes along automatically; nothing else reaches your tree.

Live resolution needs an `HttpClient`, provided at the edge with `FetchHttpClient.layer` from `effect/unstable/http` — that layer has no requirements of its own, so it works anywhere `fetch` does. If you only ever use `layerOffline`, you need no HTTP client at all.

The command-line interface ships as a separate package, so this package's consumers never install `@effect/platform-node`.

## Quick start

```ts
import { NodeResolver } from "@effected/runtimes";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const program = Effect.gen(function* () {
  const node = yield* NodeResolver;
  return yield* node.resolve({ range: ">=20", phases: ["active-lts"] });
});

Effect.runPromise(program.pipe(Effect.provide(NodeResolver.layer), Effect.provide(FetchHttpClient.layer))).then(
  console.log,
);
// ResolvedVersions {
//   source: "api",          // "cache" if the feed was unreachable and the snapshot answered
//   versions: [...],        // every active-LTS Node matching >=20, newest first
//   latest: "...",          // the newest of them
//   lts: "..."              // the newest LTS pick
// }
```

No credentials are needed for Node: both feeds it reads — nodejs.org's release index and the `nodejs/Release` schedule — are unauthenticated.

## Cache strategy as layer

Each of the three resolvers exposes the same three layer **constants**:

| Layer | Behavior | Fails with | Requires |
| ----- | -------- | ---------- | -------- |
| `layer` | Fetch live; on failure fall back to the bundled snapshot, log a warning and report `source: "cache"` | never | the resolver's transport |
| `layerFresh` | Live data or nothing | `FreshnessError` | the resolver's transport |
| `layerOffline` | The bundled snapshot only. No IO. | never | nothing |

The transport differs by runtime, and that is not an accident:

| Resolver | Feed | Requires |
| -------- | ---- | -------- |
| `NodeResolver` | nodejs.org's release index and the `nodejs/Release` schedule — both unauthenticated | `HttpClient` |
| `BunResolver` | GitHub releases for `oven-sh/bun` | `GitHubClient` |
| `DenoResolver` | GitHub releases for `denoland/deno` | `GitHubClient` |

`GitHubClient.layerDefault` is the batteries-included wiring: environment-detected credentials over `fetch`. Credential precedence is `GITHUB_PERSONAL_ACCESS_TOKEN`, then `GITHUB_TOKEN`, then anonymous — GitHub allows anonymous requests at a much lower rate limit. Supply your own with `GitHubAuth.token(redactedToken)`, or use `GitHubClient.layer` directly to bring both a credential and a transport:

```ts
import { BunResolver, DenoResolver, GitHubClient, NodeResolver } from "@effected/runtimes";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export const ResolversLive = Layer.mergeAll(
  NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
  DenoResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
);
```

`GitHubAuth.token` returns a fresh layer per call, so bind it to a const rather than calling it inline twice — layers are memoized by reference. GitHub App authentication (JWT signing plus the installation-token exchange) is deliberately not implemented, because it would mean a runtime dependency: `GitHubAuth` is a pluggable service, and an application that needs App auth supplies its own `Layer<GitHubAuth>`.

## Resolving

`resolve` takes a semver range, a grouping granularity and an optional default range. Node additionally takes the lifecycle phases to accept and the date to evaluate them at:

```ts
import { NodeResolver } from "@effected/runtimes";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const node = yield* NodeResolver;
  return yield* node.resolve({
    range: ">=18",
    phases: ["active-lts", "maintenance-lts"],
    increments: "minor",
    defaultVersion: "^22",
  });
}).pipe(Effect.provide(NodeResolver.layerOffline));
// ResolvedVersions with one entry per minor line, and `default` set to the newest match for ^22.
```

`increments` groups the matches: `latest` keeps the newest version of each major line, `minor` the newest patch of each minor line, `patch` every matching release. `range` defaults to `*`, `increments` to `latest`, and Node's `phases` to `["current", "active-lts"]`. The phase evaluation date comes from `Clock` via `DateTime.now`, so `TestClock` drives it, and passing `date` pins it explicitly.

The Node schedule is keyed by release *line*, not by major — `nodejs/Release` publishes `v0.8`, `v0.10` and `v0.12` as three distinct lines, and parsing them all down to major `0` collapses them onto whichever came first.

## Errors

| Tag | Means | Recovery |
| --- | --- | --- |
| `InvalidRangeError` | The semver range is malformed. Raised by `@effected/semver` and imported from there. | A typo in a range is a typo, not a not-found. Report it as one. |
| `NoMatchingVersionError` | The range is fine and nothing matched it. Carries `runtime`, `constraint` and the `phases` searched. | Widen the range, or accept more phases. |
| `UnresolvableDefaultError` | An explicit `defaultVersion` was asked for and nothing matched it. Carries `runtime` and `defaultVersion`. | Distinct from the above, because Node's default otherwise falls back to the LTS pick — silently dropping it would hand you LTS as though you had asked for it. |
| `FreshnessError` | `layerFresh` could not reach the feed. Carries `runtime` and the structural `cause`. | Retry, or fall back to `layer` and accept a snapshot. |
| `RateLimitError` | GitHub's rate limit is exhausted. Carries `limit`, `remaining` and, when GitHub said, `retryAfter` in seconds. | Authenticate, or back off by `retryAfter`. A `403` is classified from the response headers, never guessed from the body. |
| `AuthenticationError` | GitHub rejected the credential. Carries `method` — `"token"` or `"anonymous"`. | Check the token, or supply one. |
| `NetworkError` | The request failed, or returned a status that is neither auth nor rate limit. Carries `url`, the `status` where there was one, and the structural `cause`. | A permission `403` lands here and is not retried. |
| `ResponseParseError` | A feed responded, but not with the shape this package expects. Carries `source` and the structural `cause`. | An operator-facing signal that an upstream feed changed. Malformed data fails typed, never as a defect. |

## Features

- `NodeResolver`, `BunResolver`, `DenoResolver` — one service per runtime, each with `layer`, `layerFresh` and `layerOffline`.
- `ResolvedVersions` — `source`, `versions`, `latest`, and optionally `lts` and `default`. An empty match is an error, not an empty result, so `latest` is always present.
- `NodeSchedule` / `NodePhase` / `NodeScheduleEntry` — the `nodejs/Release` lifecycle schedule, keyed by release line, with `isLtsPhase` and `nodeReleaseLine` helpers.
- `GitHubClient` / `GitHubAuth` — a minimal GitHub REST client over `HttpClient`, with anonymous, explicit-token and environment-detected auth layers. Pagination is bounded, and a server-supplied `retry-after` is capped before it becomes a sleep.
- `BunRelease`, `DenoRelease`, `NodeRelease` — the decoded release models, plus `GitHubTag` and `GitHubRelease` for the REST payloads they are built from.
- Tagged errors throughout, each carrying its cause structurally.

## License

[MIT](LICENSE)
