---
"@effected/store": minor
---

## Features

Initial release of `@effected/store` — durable local state for [Effect](https://effect.website) v4: two services over one migration-ledger primitive, extracted from `xdg-effect`'s SQLite services and redesigned for the v4 line. The SQL core comes from `effect/unstable/sql` and the bundled driver is `@effect/sql-sqlite-node`, which peers on `effect` alone and rides Node's built-in `node:sqlite` — no native compile step:

```ts
import { Cache, Store } from "@effected/store";
import { Duration, Effect, Layer } from "effect";

const StoreLayer = Store.layerSqlite({
  filename: "/var/lib/app/state.db",
  migrations: [
    { id: 1, name: "create-notes", up: (sql) => sql`CREATE TABLE notes (body TEXT)` },
  ],
});

const CacheLayer = Cache.layerSqlite({
  filename: "/var/cache/app/cache.db",
  defaultTtl: Duration.hours(1),
  maxEntries: 1000,
});

const program = Effect.gen(function* () {
  const store = yield* Store;
  const cache = yield* Cache;
  yield* store.client`INSERT INTO notes (body) VALUES ('hello')`;
  yield* cache.set({ key: "greeting", value: new TextEncoder().encode("hi") });
  return yield* store.status;
}).pipe(Effect.provide(Layer.mergeAll(StoreLayer, CacheLayer)));
```

### Store — a schema-versioned, migrated SqlClient

`Store` is a managed database connection with a user-defined migration ledger: layer construction ensures the `_store_migrations` table and applies every pending migration, surfacing failures on the layer's typed error channel instead of the v3 `orDie` laundering. The service exposes `client` for the consumer's own queries plus `migrate`, `rollback(toId)` (running `down` migrations newest first) and `status`. A failing migration raises `StoreMigrationError` carrying `direction`, `id`, `name` and the structural `SqlError` cause; a migration callback that throws stays a defect. `up` and `down` return `Effect<unknown, SqlError>` — the engine always discards the success value, so a callback can hand back a raw `sql`...`` statement effect directly with no `Effect.asVoid` ceremony.

### Cache — TTL, tags, eviction and an event stream

`Cache` is a key → `Uint8Array` cache: lazy TTL expiry read through the clock (so `TestClock` drives it in tests), tag invalidation, transactional `onRemoved` callbacks that roll the delete back on failure while preserving the caller's error type, and a new least-recently-written `maxEntries` eviction policy that reports what it removed on the `CacheEvent` PubSub (`Hit`, `Miss`, `Set`, `Expired`, `Evicted`, `Invalidated`, `InvalidatedByTag`, `InvalidatedAll`, `Pruned`).

### Redesigned errors, and an inherited bug fixed

The v3 `reason: string` payloads are replaced by three tagged error classes — `StoreError`, `StoreMigrationError` and `CacheError` — each carrying its underlying failure structurally in `cause`, and defects are never laundered into the typed channel. The port also fixed an inherited v3 bug: `invalidateByTag` matched the raw tag against the JSON-encoded tags column, so a tag containing a backslash or quote never matched its own entry.

Both services also ship a driver-agnostic `layer` (requiring any `SqlClient`) and an in-memory `layerTest`, and a `Store` and a `Cache` can share one database file — their ledgers are separate tables.
