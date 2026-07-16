# @effected/runtimes

Resolve semver-compatible Node.js, Bun and Deno versions from live release feeds with a bundled offline snapshot fallback — three resolver services × three cache strategies over one shared engine. Boundary tier: peers on `effect`, depends on `@effected/semver`; HTTP goes through core's `HttpClient` so no platform package ever enters your tree. The `runtime-resolver` CLI binary ships from a separate repo — this library is import-only.

## Import

```ts
import { BunResolver, DenoResolver, GitHubClient, NodeResolver, NodeSchedule } from "@effected/runtimes";
```

Single entrypoint; no subpaths.

**Platform**: no platform package — provide an `HttpClient` at the edge; `FetchHttpClient.layer` (`effect/unstable/http`) works on any fetch-capable runtime. `.layerOffline` needs nothing at all.

## Core API

- **`NodeResolver` / `BunResolver` / `DenoResolver`** (`Context.Service`s) — `.resolve(options?)` → `ResolvedVersions` with honest `source: "api" | "cache"` provenance; typed errors `InvalidRangeError` (from `@effected/semver`), `NoMatchingVersionError`, `UnresolvableDefaultError`. Each ships three layer consts: `.layer` (live, snapshot fallback with a logged warning), `.layerFresh` (live or typed `FreshnessError`), `.layerOffline` (bundled snapshot; no IO, no requirements).
- **`GitHubClient` / `GitHubAuth`** — the authenticated REST seam Bun/Deno need; `GitHubClient.layerDefault` pre-wires `GitHubAuth.layerConfig` + `FetchHttpClient.layer`. `NodeResolver` needs only `HttpClient` (nodejs.org is unauthenticated).
- **`NodeSchedule` / `NodeRelease`** — Node release-line lifecycle; `phaseFor(version, now)` is an instance method on the yielded schedule.

## Usage

```ts
import { BunResolver, GitHubClient, NodeResolver } from "@effected/runtimes";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const RuntimesLive = Layer.mergeAll(
 NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
 BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
);

const program = Effect.gen(function* () {
 const node = yield* NodeResolver;
 return (yield* node.resolve({ range: ">=20", phases: ["active-lts"] })).latest;
}).pipe(Effect.provide(RuntimesLive));
```

## Testing machinery

None dedicated, but `.layerOffline` (no IO, no requirements, deterministic snapshot) is the natural test layer.

## Gotchas

- `source` is honest provenance: auto-strategy fallback sets `"cache"` and logs a warning — don't assume `"api"`.
- Node's schedule is keyed by release LINE (`"0.10"`), not bare major — major `0` returns `None` by design.
- GitHub App auth (JWT/installation tokens) is deliberately not included — supply your own `Layer<GitHubAuth>` if you need it.
- Layer factories memoize by reference — bind to a `const`.
- An invalid range is a typed `InvalidRangeError` (import it from `@effected/semver`; not re-exported here), never a silent "no versions found".
