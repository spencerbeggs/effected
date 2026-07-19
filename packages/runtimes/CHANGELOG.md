# @effected/runtimes

## 0.1.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.1.0 | 0.1.1 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

* Resolve semver-compatible Node.js, Bun and Deno versions from the live release feeds, with a bundled offline snapshot as a fallback. Every answer carries an honest `source` — `"api"` when the feed replied, `"cache"` when the snapshot did.

  ### Per-runtime resolvers

  `NodeResolver`, `BunResolver` and `DenoResolver` each resolve a semver range against a runtime's releases, newest first, with the LTS pick and an optional nominated default.

  ```ts
  import { NodeResolver } from "@effected/runtimes";
  import { Effect } from "effect";
  import { FetchHttpClient } from "effect/unstable/http";

  const program = Effect.gen(function* () {
    const node = yield* NodeResolver;
    return yield* node.resolve({ range: ">=20", phases: ["active-lts"] });
  });

  Effect.runPromise(
    program.pipe(Effect.provide(NodeResolver.layer), Effect.provide(FetchHttpClient.layer)),
  );
  // ResolvedVersions { source: "api", versions: [...], latest: "...", lts: "..." }
  ```

  ### Cache strategy is a layer, not a flag

  Each resolver exposes three layer constants: `layer` fetches live and falls back to the snapshot (logging a warning and reporting `source: "cache"`), `layerFresh` fails with `FreshnessError` rather than serve stale data, and `layerOffline` reads the bundled snapshot only — no IO, no requirements.

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

  Node reads the unauthenticated nodejs.org index and `nodejs/Release` schedule, so it needs only an `HttpClient`; Bun and Deno read GitHub releases through `GitHubClient`, with anonymous, explicit-token (`GitHubAuth.token`) and environment-detected (`GitHubClient.layerDefault`) auth. Tagged errors throughout — `NoMatchingVersionError`, `FreshnessError`, `RateLimitError` and the rest — each carry their cause structurally. [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
