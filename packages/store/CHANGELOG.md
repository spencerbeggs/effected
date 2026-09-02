# @effected/store

## 0.6.0

### Features

#### `Cache.degrading` — an opt-in degrade-to-miss posture

- Wraps any `Cache` layer so a **construction** failure yields a working, empty cache instead of failing the layer: reads miss, writes are discarded, and the new `CacheShape.degraded` field reads `true`.

```ts
import { Cache } from "@effected/store";

const CacheLayer = Cache.degrading(Cache.layerSqlite({ filename: "cache.db" }));
```

- An unreachable or corrupt cache is a cache miss, and must not fail a build that would otherwise succeed. Written inside each service method, that posture holds only while the layer is built inside those methods — hoisting construction to the runtime, an ordinary performance fix, moves the failure to runtime build time where it aborts the whole program. Nothing about that change looks behavioural, and a suite that never fails construction cannot catch it.

- Two details are easy to get wrong by hand, and both are handled here:

- **Defects are caught.** `SqliteClient.layer` reports its most common construction failure — a `filename` whose parent directory does not exist — as a defect rather than a typed failure, so a failure-only catch misses exactly the case this exists for.

- **Interruption is not caught.** Interruption is the caller shutting down, not a broken cache; swallowing it would hand a working cache back to a fiber that was meant to stop.

- **Interruption wins on overlap.** When a cause carries both a construction failure and an interrupt — parallel layer construction where one branch fails and another is interrupted — the interrupt path is taken and the failure is not reported. Correct, since a shutting-down fiber must not be handed a working cache, but worth knowing: the failure that also occurred will not appear in the re-raised cause.

- This is **opt-in and not the default**. A consumer that wants a cache problem to be fatal, or that wants a narrower per-operation posture with the layer left fatal, keeps exactly that by not calling it. The existing constructors' typed error channels are unchanged.

#### `CacheShape.degraded`

- New field on the service shape, `false` for every real cache. Without it a cold cache and a broken one are indistinguishable, since every read misses either way. It is a plain field rather than a `CacheEventPayload` member because degradation is decided at construction, before any subscriber exists, and the `events` hub does not replay. The construction failure is also logged once at warning level with its cause.

- A consumer hand-implementing `CacheShape` — rather than getting it back from `layer`, `layerSqlite`, `layerTest`, or `Cache.degrading` — must add `degraded` to compile against this release. [#581][#581]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#581]: https://github.com/spencerbeggs/effected/pull/581

## 0.5.0

### Features

- `Store.layerSqlite` and `Cache.layerSqlite` gain two options:

- `client` — an `Omit<SqliteClientConfig, "filename" | "transformResultNames" | "transformQueryNames">` passthrough to `SqliteClient.layer`, for tuning the underlying SQLite driver. `filename` stays owned by the layer, and the two name-transform options stay excluded — they would silently rewrite the migration ledger's own column names.

- `checkpointOnClose` — registers a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs before the driver closes the connection, folding the WAL into the main database file eagerly. Useful when another process may open the file right after this scope closes. The checkpoint is best-effort: a failure never turns a clean shutdown into a failed one. [#517][#517]

```ts
const StoreLayer = Store.layerSqlite({
	filename: "state.db",
	migrations,
	client: { readonly: false },
	checkpointOnClose: true,
});
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#517]: https://github.com/spencerbeggs/effected/pull/517

## 0.4.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |  |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Features

- ### `Cache.through` — read-through caching in one call
  `get` → decode → on miss fetch → encode → `set` was roughly twenty-five lines every consumer wrote for itself. It is now one:
  ```ts
  const members = yield* Cache.through("team:platform", Schema.fromJsonString(Members), {
  	ttl: "1 hour",
  	tags: ["team"],
  })(fetchMembersFromApi);
  ```
  `Cache.throughVerbose` returns `{ value, hit }` for callers that need to say *(cached)* in their output — previously only reachable by subscribing to the `CacheEvent` PubSub and correlating by key, which is a telemetry channel being used as a return value.

  Two policies the package now owns rather than leaving to each consumer:
  - **A stored value that fails to decode is a miss, not a failure.** Those bytes were written by an older build of the caller's own program; the user did not cause it, cannot fix it without knowing the cache exists, and everything cached is re-derivable by definition. The stale entry is overwritten on the way out.
  - **`CacheError` is surfaced, not swallowed.** A cache is additive and a caller may reasonably want to push through a broken one, but that is the caller's decision to make with `Effect.catchTag("CacheError", …)`. A database that cannot be read is real and reportable, so it is not hidden here.

  ### `Uint8ArrayFromUtf8` — the missing UTF-8 codec
  Core's Schema ships `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and `Uint8ArrayFromHex`, and nothing for UTF-8. So this package's own advice — cache values are bytes, encode them deliberately through a schema — could not be followed to the end: `Schema.fromJsonString(schema)` reaches `string` and stops. Consumers hand-wired a `TextEncoder` at exactly the seam the advice exists to close, or paid base64's 33% size premium to stay inside Schema.

  `Uint8ArrayFromUtf8` closes it. Encoding fails on malformed UTF-8 rather than substituting replacement characters, so a corrupt value stays distinguishable from a valid one containing `U+FFFD`.

### Documentation

- `Cache` and `App.layer` now document the `TestClock` ordering that decides whether cache expiry is testable at all: provide `TestClock.layer()` **outside** the `Effect.provide` supplying the cache, never beneath it. Underneath, the test body has no `TestClock` in its context and `TestClock.adjust` dies as a defect, so nothing you try to expire ever expires. [#352][#352]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352

## 0.2.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.3

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.2

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |  |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |  |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

- Initial release: durable local state for Effect — two services over one SQLite primitive, running on Node's built-in `node:sqlite` with no native compile step. Both surface failures as tagged errors carrying the underlying `SqlError` structurally.
  ### Store — a migrated SqlClient
  `Store` is a schema-versioned, migrated `SqlClient` with a migration ledger you own: `up`, `down`, `rollback` and a `status` projection. Layer construction runs pending migrations and puts any failure on the layer's typed error channel.
  ```ts
  import { Store, type StoreMigration } from "@effected/store";
  import { Effect } from "effect";

  const migrations: ReadonlyArray<StoreMigration> = [
    {
      id: 1,
      name: "create-notes",
      up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
      down: (sql) => sql`DROP TABLE notes`,
    },
  ];

  const StoreLive = Store.layerSqlite({ filename: "state.db", migrations });

  const program = Effect.gen(function* () {
    const store = yield* Store;
    const sql = store.client;
    yield* sql`INSERT INTO notes (body) VALUES (${"first"})`;
    return yield* sql<{ id: number; body: string }>`SELECT id, body FROM notes`;
  });

  Effect.runPromise(program.pipe(Effect.provide(StoreLive))).then(console.log);
  // [ { id: 1, body: "first" } ]
  ```
  ### Cache — TTL, tags and eviction
  `Cache` stores `key → Uint8Array` with an optional TTL, tags for bulk invalidation, a `maxEntries` eviction policy, a transactional `onRemoved` callback and a `PubSub` of lifecycle events. Expiry is lazy and clock-driven, so `TestClock` drives it deterministically.
  ```ts
  import { Cache } from "@effected/store";
  import { Duration, Effect } from "effect";

  const CacheLive = Cache.layerSqlite({ filename: "cache.db", maxEntries: 1000 });

  const program = Effect.gen(function* () {
    const cache = yield* Cache;
    yield* cache.set({
      key: "npm:effect",
      value: new TextEncoder().encode(`{"name":"effect"}`),
      tags: ["npm", "registry"],
      ttl: Duration.minutes(10),
    });
    const hit = yield* cache.get("npm:effect");
    return yield* cache.invalidateByTag("npm");
  });

  Effect.runPromise(program.pipe(Effect.provide(CacheLive))).then(console.log);
  // { count: 1, keys: [ "npm:effect" ] }
  ```
  Both services expose the same `layer` / `layerSqlite` / `layerTest` trio — driver-agnostic, batteries-included and in-memory — and fail through `StoreError`, `StoreMigrationError` and `CacheError`. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
