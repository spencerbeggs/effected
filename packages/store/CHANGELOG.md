# @effected/store

## 0.2.0

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.3

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.2

### Dependencies

* | Dependency              | Type           | Action  | From          | To             |                                                                       |
  | ----------------------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | @effect/sql-sqlite-node | dependency     | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                       |
  | effect                  | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.1

### Dependencies

* | Dependency              | Type           | Action  | From          | To            |                                                                       |
  | ----------------------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | @effect/sql-sqlite-node | dependency     | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                                       |
  | effect                  | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

* Initial release: durable local state for Effect — two services over one SQLite primitive, running on Node's built-in `node:sqlite` with no native compile step. Both surface failures as tagged errors carrying the underlying `SqlError` structurally.

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
