---
"@effected/store": minor
---

## Features

Initial release: durable local state for Effect — two services over one SQLite primitive, running on Node's built-in `node:sqlite` with no native compile step. Both surface failures as tagged errors carrying the underlying `SqlError` structurally.

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

Both services expose the same `layer` / `layerSqlite` / `layerTest` trio — driver-agnostic, batteries-included and in-memory — and fail through `StoreError`, `StoreMigrationError` and `CacheError`.
