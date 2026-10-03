# @effected/store

Durable local state: `Store` is a schema-versioned, migrated SQLite `SqlClient`; `Cache` is a `key → Uint8Array` TTL cache with tags, eviction and an event stream. **Store is your schema — migrations create your tables, `client` queries them.** It is not a key-value store; the KV shape is `Cache` (or core's `KeyValueStore`). Integrated tier: it owns the one real backend dependency in the kit (`@effect/sql-sqlite-node`), and depending on it makes YOUR package integrated too.

## Import

```ts
import { Cache, Store } from "@effected/store";
```

Single entrypoint; no subpaths.

**Platform**: nothing to provide for `layerSqlite`/`layerTest` — the SQLite driver (`@effect/sql-sqlite-node`) ships as a regular dependency, which makes those layers Node-only. The abstract `Store.layer`/`Cache.layer` take any `SqlClient` you provide in `R`, so a different driver can be wired at the edge.

## Core API

- **`Store`** (`Context.Service`) — `client: SqlClient` (tagged-template SQL), `migrate`, `rollback(toId)`, `status`. Layers: `Store.layer(options)` (abstract — needs a `SqlClient` in `R`), `Store.layerSqlite(options & { filename })` (batteries included; the parent directory of `filename` must already exist — see Gotchas), `Store.layerTest(options)` (`:memory:`). A `StoreMigration`'s `up`/`down` return `Effect<unknown, SqlError>`.
- **Sqlite layer options** (`Store.layerSqlite` and `Cache.layerSqlite` alike) — `client` passes the remaining driver options through (`disableWAL`, `busyTimeout`, `prepareCacheSize`/`prepareCacheTTL`, `readonly`, `spanAttributes`; NOT the name-transform options, which would break the internal ledger queries), and `checkpointOnClose: true` registers the `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs before the driver closes the connection. The driver opens ONE serialized connection per layer build and sets `journal_mode = WAL` (unless `disableWAL`) and `busy_timeout` (`busyTimeout`, default 5 s) on it itself — set those through `client`, never inside a migration (a migration runs once per database, not once per connection). For a per-connection setting `client` cannot carry, use `onConnect` (below).
- **Several processes opening one file** (parallel CLI hooks) never run an `up` twice: each migration's transaction re-checks the ledger under the SQLite driver's `BEGIN IMMEDIATE` write lock, and the loser waits up to `client.busyTimeout` then skips. One driver limit remains: several processes creating a BRAND-NEW file at once can die with `database is locked` (SQLite refuses the first switch to WAL immediately, ignoring `busyTimeout`). Create the file in WAL mode once from one process first, or WARM UP: retry only `Effect.scoped(Layer.build(StoreLive))` with jittered backoff on `SQLITE_BUSY` (`code === "ERR_SQLITE_ERROR" && errcode === 5`), then run the program once, unretried. Never retry the whole program, and an immediate retry is not enough.
- **`StoreOptions.mirrorMigratorLedger`** (`boolean` or `{ table }`; `false` is off) — for a transition period in which OLDER versions still migrate the same file through effect/sql's `Migrator`: TWO-WAY for matching rows: every build creates `effect_sql_migrations` (effect/sql's exact SQLite DDL), IMPORTS foreign rows an older program applied (matched by id AND name; unknown id / mismatch fails typed) and copies out Store's own; every apply re-checks the foreign table under the write lock and imports instead of re-running, else inserts the row; rollback deletes it — so neither side ever re-runs the other's migration. Every rollback (mirror ON OR OFF) tombstones the ids in `_store_meta` with a snapshot of the foreign row, so a mirrored reopen re-runs a migration Store rolled back (stale row) but imports one an older program re-applied (changed row); an unsnapshotted table is refused typed. Pair with `adoptMigratorLedger` (same default table). SQLite only.
- **`onConnect`** (on `Store.layerSqlite`/`Cache.layerSqlite` options) — runs once per build (= once per connection) before the ledger and OUTSIDE any transaction; failure is `StoreError`/`CacheError` `setup`. Foreign keys need NO hook: `node:sqlite` enables `foreign_keys` on every connection by default.
- **`Store.sqlClient(tag)`** → `Layer<SqlClient, never, I>` — a keyed store's `client` as the bare `SqlClient`, for existing layers written against it; provide it to those layers only.
- **Logs** — migration progress at `Debug` in effect/sql's `Migrator` shape: `Running migration` (`migration_id`, `migration_name`), `Migrations complete` (`latest_migration_id`, `latest_migration_name`), plus `Adopted migrator ledger`, `Imported migrator ledger rows` and `Imported migration` when the ledger options copy history in. Raise `References.MinimumLogLevel` to `Debug` to see them; `Cache`'s own schema ledger logs the same records.
- **`StoreError.message`** reads `Store <operation> failed: <reason>`: for a SQL failure the reason is the database's own text (`UNIQUE constraint failed: t.id`), walked out of the `SqlError` cause chain — never a bound value. `cause` is untouched.
- **`Store.layerSqliteAs(tag, options)` / `Cache.layerSqliteAs(tag, options)`** → `Layer<I, …>` — a second database under a key you define: `class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}`. Outputs only your key (the inner `Store`/`Cache` never leaks, so it sits beside a primary). The key's service type must be `StoreShape`/`CacheShape` — one that adds members (`StoreShape & { … }`) errors as "not assignable to parameter of type 'never'"; the check cannot see through method-syntax parameter bivariance (a member redeclared as a method with a wider parameter still compiles).
- **`StoreOptions.adoptMigratorLedger`** (`boolean` or `{ table }`; `false` is off) — move a live database off `effect/sql/Migrator` (`SqliteMigrator.layer`) without re-running its history. ONE-SHOT: the first layer build with the option on decides, in one write-locked transaction — copies the rows only when `_store_migrations` is empty and `effect_sql_migrations` exists, and always records the decision in `_store_meta`, so later builds (even after `rollback(0)`) skip it and re-apply from scratch instead of re-adopting. Never writes the foreign table; a failed adoption records nothing and retries next build. SQLite only (other dialects fail typed). Zone-less `created_at` is UTC; an unreadable one fails typed. It honours rollback history: a foreign row unchanged since a Store `rollback` (made with or without the option) is stale and re-runs instead of being adopted, so enabling it after such a rollback is safe. Matching is EXACT: each foreign row needs a migration with the same `id` AND `name`, where the Migrator recorded names prefix-stripped — `fromRecord`'s `"0001_initial"` ⇒ `{ id: 1, name: "initial" }`; and no migration at or below the highest id it actually ADOPTS may be missing from the foreign ledger (the Migrator never ran it); stale rows are not adopted, so they never set that mark. Turning it on after a database is already Store-migrated records the decision and adopts nothing. A mismatch fails typed: `StoreError` with `operation: "adopt"`.
- **`Cache`** (`Context.Service`) — `get`, `set`, `has`, `entries` (metadata only; never loads BLOBs), `invalidate`/`invalidateByTag`/`invalidateAll`/`prune` (each with an optional transactional `onRemoved` callback), `events: PubSub<CacheEvent>`. Same layer trio: `Cache.layer` / `Cache.layerSqlite` / `Cache.layerTest`.
- **`Cache.through(key, schema, options?)(onMiss)`** and **`Cache.throughVerbose`** — read-through caching in one call. `get` → decode → run `onMiss` → encode → `set` was ~25 lines every consumer wrote for itself. **Statics, not shape members**: they take `Cache` from context, so `R` includes `Cache` and no test double needs an implementation. `throughVerbose` returns `{ value, hit }` for a caller that wants to print *(cached)* — the `CacheEvent` PubSub is telemetry and the wrong channel for that. Two policies the package owns: **a stored value that fails to decode (or is not valid UTF-8) is a MISS, not a failure**, and is overwritten; **`CacheError` is surfaced, not swallowed** — catch it yourself with `catchTag` if a broken cache should not stop you.
- **`Uint8ArrayFromUtf8`** — a `Schema.Codec<Uint8Array, string>`. Cache values are bytes, and core's Schema ships only `Uint8ArrayFromBase64` / `…Base64Url` / `…FromHex` — **nothing for UTF-8** — so "encode through a schema" could not be completed and every consumer hand-wired a `TextEncoder`. Encoding fails on malformed UTF-8 rather than substituting `U+FFFD`. Prefer a core equivalent if one ever ships.
- Errors: `StoreError` (`operation`: `setup` | `adopt` | `migrate` | `rollback` | `status`), `StoreMigrationError`, `CacheError`; events: `CacheEvent`/`CacheEventPayload`.

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
 yield* cache.set({ key: "pkg:some-package", value: new TextEncoder().encode("1.2.3"), tags: ["registry"] });
 const { count, keys } = yield* cache.invalidateByTag("registry", (result) =>
  Effect.log(`evicting ${result.count} entries: ${result.keys.join(", ")}`),
 );
 return { count, keys };
});
```

## Testing machinery

**`Store.layerTest(options)`** and **`Cache.layerTest(options)`** are exported hermetic `:memory:` layers — use them directly in consumer test suites.

**Testing expiry has an ordering rule**: provide `TestClock.layer()` **outside** the `Effect.provide` that supplies the cache, never beneath it. Underneath, the test body has no `TestClock` in its own context and `TestClock.adjust` **dies as a defect** — so nothing you try to expire ever expires.

## Gotchas

- The layer statics are parameterized factories and layers memoize BY REFERENCE: calling `Store.layerSqlite(...)` inline at two sites opens the database twice (and two Cache PubSubs each see half the events). Bind to a `const` and reuse. A bound const is built once per provided layer graph — and an `Effect.provide` nested inside another reuses it — but two provides that are NOT nested (sequential, or siblings) each open it again.
- `SqliteClient.layer` has no error channel — a `filename` whose parent directory doesn't exist is a defect; ensure the directory first (or let `@effected/app` do it).
- No defect laundering: a throwing migration or `onRemoved` callback stays a defect, never a typed error.
- `invalidateByTag` matches JSON-encoded tags with escaped LIKE metacharacters — tags containing backslashes/quotes won't match raw-string comparisons.
- Eviction is least-recently-WRITTEN (rowid order), not LRU-read.
- There is no `@effect/sql` package on v4 — `SqlClient`/`SqlError` live in `effect/sql`.
- A database previously migrated by `effect/sql/Migrator` keeps its ledger in `effect_sql_migrations`; without `adoptMigratorLedger`, first construction re-runs every migration (a bare `CREATE TABLE` then fails as `StoreMigrationError`). Turn the option on — and name migrations `"initial"`, not `"0001_initial"`.
