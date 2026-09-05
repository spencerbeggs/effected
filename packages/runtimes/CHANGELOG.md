# @effected/runtimes

## 0.5.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.5.1 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.4.7

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#620][#620]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#620]: https://github.com/spencerbeggs/effected/pull/620

## 0.4.6

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#596][#596]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#596]: https://github.com/spencerbeggs/effected/pull/596

## 0.4.5

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#564][#564]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#564]: https://github.com/spencerbeggs/effected/pull/564

## 0.4.4

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#553][#553]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#553]: https://github.com/spencerbeggs/effected/pull/553

## 0.4.3

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#450][#450]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#450]: https://github.com/spencerbeggs/effected/pull/450

## 0.4.2

### Performance

- Reduced allocation overhead while building runtime release lists in `@effected/runtimes` by avoiding an intermediate `Option[]` and second-pass flatten step in feed-to-model projection.
  - Output ordering and filtering semantics are unchanged.
  - Public API and compatibility guarantees are unchanged. [#442][#442]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#442]: https://github.com/spencerbeggs/effected/pull/442

## 0.4.1

### Performance

- `ReleaseIndex.resolve` now short-circuits on the first matching release instead of materializing a full filtered array first.

  In a local microbenchmark over 20,000 releases, this reduced resolve time by about 9.5x when the first match was mid-list and about 1.8x when no release matched.
  - Output and ordering are unchanged: resolution still returns the newest matching release.
  - Public APIs and compatibility guarantees are unchanged. [#420][#420]

* `NodeResolver` now fetches the Node dist index and the Node schedule feed concurrently instead of serializing two independent network requests.
  - Resolution results, errors, public API, and offline fallback behavior are unchanged; only the live-feed load path overlaps the two HTTP calls. [#414][#414]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#414]: https://github.com/spencerbeggs/effected/pull/414

[#420]: https://github.com/spencerbeggs/effected/pull/420

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.7

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#307][#307]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#307]: https://github.com/spencerbeggs/effected/pull/307

## 0.2.6

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#303][#303]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#303]: https://github.com/spencerbeggs/effected/pull/303

## 0.2.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 0.2.4

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#245][#245]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#245]: https://github.com/spencerbeggs/effected/pull/245

## 0.2.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

## 0.2.1

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#205][#205]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#205]: https://github.com/spencerbeggs/effected/pull/205

## 0.2.0

### Breaking Changes

- ### Resolver layers fetch on first resolve rather than at acquisition
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

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.2.0 | 0.2.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Maintenance

- Refreshed the bundled Node.js, Bun and Deno version defaults from the upstream release feeds [#158][#158]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#158]: https://github.com/spencerbeggs/effected/pull/158

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.4

### Maintenance

- Refreshed the bundled offline snapshot data used by `layerOffline` and the `layer` auto-fallback, picking up newly released Deno versions. [#152][#152]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#152]: https://github.com/spencerbeggs/effected/pull/152

## 0.1.3

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.1.1 | 0.2.0 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.1.0 | 0.1.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

- Resolve semver-compatible Node.js, Bun and Deno versions from the live release feeds, with a bundled offline snapshot as a fallback. Every answer carries an honest `source` — `"api"` when the feed replied, `"cache"` when the snapshot did.
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

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
