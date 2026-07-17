# @effected/store

Durable local state: `Store` is a schema-versioned, migrated SQLite `SqlClient`; `Cache` is a `key → Uint8Array` TTL cache with tags, eviction and an event stream. Integrated tier: it owns the one real backend dependency in the kit (`@effect/sql-sqlite-node`), and depending on it makes YOUR package integrated too.

## Import

```ts
import { Cache, Store } from "@effected/store";
```

Single entrypoint; no subpaths.

**Platform**: nothing to provide for `layerSqlite`/`layerTest` — the SQLite driver (`@effect/sql-sqlite-node`) ships as a regular dependency, which makes those layers Node-only. The abstract `Store.layer`/`Cache.layer` take any `SqlClient` you provide in `R`, so a different driver can be wired at the edge.

## Core API

- **`Store`** (`Context.Service`) — `client: SqlClient` (tagged-template SQL), `migrate`, `rollback(toId)`, `status`. Layers: `Store.layer(options)` (abstract — needs a `SqlClient` in `R`), `Store.layerSqlite(options & { filename })` (batteries included), `Store.layerTest(options)` (`:memory:`). A `StoreMigration`'s `up`/`down` return `Effect<unknown, SqlError>`.
- **`Cache`** (`Context.Service`) — `get`, `set`, `has`, `entries` (metadata only; never loads BLOBs), `invalidate`/`invalidateByTag`/`invalidateAll`/`prune` (each with an optional transactional `onRemoved` callback), `events: PubSub<CacheEvent>`. Same layer trio: `Cache.layer` / `Cache.layerSqlite` / `Cache.layerTest`.
- Errors: `StoreError`, `StoreMigrationError`, `CacheError`; events: `CacheEvent`/`CacheEventPayload`.

## Usage

```ts
import { Store } from "@effected/store";
import { Effect } from "effect";

const StoreLive = Store.layerSqlite({
 filename: "app.db",
 migrations: [{ id: 1, name: "init", up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)` }],
});

const program = Effect.gen(function* () {
 const store = yield* Store;
 yield* store.client`INSERT INTO notes (body) VALUES ('hi')`;
}).pipe(Effect.provide(StoreLive));
```

Tag-based invalidation with a transactional callback — `onRemoved` runs inside the same delete transaction, before it commits, and only when something was actually removed:

```ts
import { Cache } from "@effected/store";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const cache = yield* Cache;
 yield* cache.set({ key: "pkg:effect", value: new TextEncoder().encode("4.0.0-beta.98"), tags: ["registry"] });
 const { count, keys } = yield* cache.invalidateByTag("registry", (result) =>
  Effect.log(`evicting ${result.count} entries: ${result.keys.join(", ")}`),
 );
 return { count, keys };
});
```

## Testing machinery

**`Store.layerTest(options)`** and **`Cache.layerTest(options)`** are exported hermetic `:memory:` layers — use them directly in consumer test suites.

## Gotchas

- The layer statics are parameterized factories and layers memoize BY REFERENCE: calling `Store.layerSqlite(...)` at two provide sites opens the database twice (and two Cache PubSubs each see half the events). Bind to a `const` and reuse.
- `SqliteClient.layer` has no error channel — a `filename` whose parent directory doesn't exist is a defect; ensure the directory first (or let `@effected/app` do it).
- No defect laundering: a throwing migration or `onRemoved` callback stays a defect, never a typed error.
- `invalidateByTag` matches JSON-encoded tags with escaped LIKE metacharacters — tags containing backslashes/quotes won't match raw-string comparisons.
- Eviction is least-recently-WRITTEN (rowid order), not LRU-read.
- There is no `@effect/sql` package on v4 — `SqlClient`/`SqlError` live in `effect/unstable/sql`.
