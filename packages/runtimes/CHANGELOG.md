# @effected/runtimes

## 0.4.1

### Performance

* `NodeResolver` now fetches the Node dist index and the Node schedule feed concurrently instead of serializing two independent network requests.

  * Resolution results, errors, public API, and offline fallback behavior are unchanged; only the live-feed load path overlaps the two HTTP calls. [#414][#414]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#414]: https://github.com/spencerbeggs/effected/pull/414

## 0.4.0

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |

* | Dependency | Type           | Action  | From           | To           |                                                                       |
  | :--------- | :------------- | :------ | :------------- | :----------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.7

### Maintenance

* Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#307][#307]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#307]: https://github.com/spencerbeggs/effected/pull/307

## 0.2.6

### Maintenance

* Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#303][#303]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#303]: https://github.com/spencerbeggs/effected/pull/303

## 0.2.5

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

* | Dependency       | Type       | Action  | From  | To    |                                                          |
  | ---------------- | ---------- | ------- | ----- | ----- | -------------------------------------------------------- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 0.2.4

### Maintenance

* Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#245][#245]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#245]: https://github.com/spencerbeggs/effected/pull/245

## 0.2.3

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

## 0.2.1

### Maintenance

* Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#205][#205]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#205]: https://github.com/spencerbeggs/effected/pull/205

## 0.2.0

### Breaking Changes

* ### Resolver layers fetch on first resolve rather than at acquisition

  `NodeResolver.layer`, `BunResolver.layer` and `DenoResolver.layer` performed their release-feed fetch when the layer was acquired. Merging all three into one application layer therefore fetched three feeds even when only one runtime was ever resolved, which cost rate limit against the anonymous GitHub quota and logged a snapshot-fallback warning for runtimes nobody asked about.

  Population now runs behind a once-gate on the first `resolve` call:

  ```ts
  const layer = Layer.mergeAll(
    NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
    DenoResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
  );

  // before: building this fetched all three feeds
  // after: nothing is fetched until a resolver's resolve() is called
  ```

  Concurrent first calls share one fetch. A successful population is memoized for the layer's lifetime, including the auto strategy's fall back to the bundled snapshot, so a dead feed is not re-hammered. A failed fresh population is not memoized, leaving the next `resolve` free to retry.

  **Migration.** The freshness error moves out of the layer's error channel and into `resolve`'s, so code that handled it while building the layer now handles it at the call site. Consumers that worked around the old behavior by providing each resolver narrowly inside the branch that used it can merge the layers again. [#175][#175]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.1.5

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.0 | 0.2.1 |

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Maintenance

* Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#158][#158]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#158]: https://github.com/spencerbeggs/effected/pull/158

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.4

### Maintenance

* Refreshed the bundled offline snapshot data used by `layerOffline` and the `layer` auto-fallback, picking up newly released Deno versions. [#152][#152]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#152]: https://github.com/spencerbeggs/effected/pull/152

## 0.1.3

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.1.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.1.1 | 0.2.0 |

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
