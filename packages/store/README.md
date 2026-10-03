# @effected/store

[![npm](https://img.shields.io/npm/v/@effected%2Fstore?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/store)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Durable local state for Effect: two services over one primitive. `Store` is a schema-versioned, migrated `SqlClient` — a managed database connection with a user-defined migration ledger that supports `up`, `down`, rollback and a status projection. `Cache` is a `key → Uint8Array` cache with TTL, tags, bulk invalidation, an eviction policy and a `PubSub` of lifecycle events. Both run on SQLite through Node's built-in `node:sqlite`, so there is no native compile step, and both surface their failures as tagged errors that carry the underlying `SqlError` structurally.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `^4.0.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/store

A store and a cache look like the same thing with a flag on it, and treating them that way is how caches end up holding data nobody can afford to lose. An evicted cache entry is correct behaviour; a lost state row is a bug. So they are two services here, with different contracts — only `Cache` has TTL, tags and eviction, and only `Store` has a migration ledger you own. They do share the ledger engine underneath, keyed by table name, so a `Store` and a `Cache` can live in the same database file without colliding.

The other thing this package refuses is defect laundering. A migration that throws is a programmer error, not a database failure, and it stays a defect rather than arriving as a `StoreError` you might be tempted to retry. Only a typed `SqlError` becomes a domain error, and it is carried whole rather than flattened into a `reason` string. Layer construction runs pending migrations and puts the failure on the layer's typed error channel — no `orDie` hiding a broken schema behind a working service.

## Install

```bash
npm install @effected/store effect
```

```bash
pnpm add @effected/store effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency. The SQLite driver (`@effect/sql-sqlite-node`) is a regular dependency of this package, so you do not install it yourself — it rides Node's built-in `node:sqlite`, with no native build and no transitive peers of its own. That single runtime dependency is what makes this the repo's one integrated-tier package: anything that depends on `@effected/store` inherits the driver.

## Quick start

Declare your migrations, bind the layer to a const, and use `store.client` for your own queries:

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

// The filename reaches SQLite as given, so its parent directory must already
// exist. Use `@effected/xdg` to resolve (and create) a real application data dir.
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

The layer statics are parameterized *factories*, not layers. Calling `Store.layerSqlite(...)` twice builds two layers, and Layer memoization is by reference — bind the result to a const, as above, or the database is opened twice.

The parent directory of `filename` must exist. The SQLite driver's construction has no error channel, so a missing directory arrives as a defect rather than a typed failure; creating it is the caller's job, and [`@effected/xdg`](../xdg) is the package that knows where the directory belongs.

## The layer trio

Both services expose the same three statics, and the split is the seam:

| Static | What it provides | Requirements |
| ------ | ---------------- | ------------ |
| `layer(options)` | The service over an abstract `SqlClient` — any Effect SQL driver satisfies it | `SqlClient` |
| `layerSqlite(options & { filename })` | The service plus the SQLite driver | none |
| `layerTest(options)` | `layerSqlite` at `:memory:`; hermetic, what the suites use | none |

The SQL core lives in `effect` itself, under `effect/sql` — there is no `@effect/sql` package on the v4 line, so `SqlClient` is imported from `effect/sql/SqlClient`.

### Driver options

`layerSqlite` takes the rest of the driver's configuration through `client`, so tuning the SQLite client no longer means dropping to the abstract `layer` with a hand-wired driver:

```ts
const StoreLive = Store.layerSqlite({
  filename: "state.db",
  migrations,
  client: { disableWAL: true, prepareCacheSize: 50 },
  checkpointOnClose: true,
});
```

- **`client`** passes through everything `SqliteClient.layer` accepts except `filename` (owned by this layer) and the two name-transform options — `transformResultNames`/`transformQueryNames` would rewrite the result names of the migration ledger's own queries and silently report every migration pending. If you need name transforms, wire your own client under the abstract `layer`.
- **`checkpointOnClose: true`** registers a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs against the still-open connection, before the driver closes it — the finalizer every durable-SQLite consumer was writing by hand. Best-effort: a failing checkpoint never turns a clean shutdown into a failed one. SQLite-specific, so it lives on the sqlite layers only; `layerTest` (`:memory:`) has no WAL and never checkpoints.

`Cache.layerSqlite` takes the same two options.

## Migrations

Migrations are a list you own: a positive-integer `id`, a `name` recorded in the ledger, an `up`, and an optional `down`. Both return `Effect<unknown, SqlError>`, so a tagged SQL template goes back as-is — the engine discards the value, and a `CREATE TABLE` that already describes itself needs no `Effect.asVoid` wrapped around it. Layer construction ensures the ledger table and applies everything pending, so a freshly built `Store` is already migrated. `migrate` re-runs pending migrations, `rollback(toId)` unwinds everything with `id > toId` newest-first (`rollback(0)` unwinds all of it), and `status` projects the full list with each migration's `appliedAt`:

```ts
import { Store } from "@effected/store";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const store = yield* Store;
  yield* store.rollback(0);
  return yield* store.status;
});
// Every migration is listed, each with `appliedAt` absent — they are all pending again.
```

Duplicate ids, non-positive-integer ids and a non-integer `toId` are wiring errors, not data conditions: they die at layer construction rather than failing typed. A migration that *throws* stays a defect too, and the surrounding transaction rolls back.

Migration progress is logged at `Debug`, in effect/sql's `Migrator` shape so a program moving over loses nothing: one `Running migration` record per applied migration (annotated `migration_id`, `migration_name`) and one `Migrations complete` record per run (annotated `latest_migration_id`, `latest_migration_name`). Adoption that copies rows adds an `Adopted migrator ledger` record (`migrator_table`, `adopted_count`, `latest_migration_id`, `latest_migration_name`). With `mirrorMigratorLedger`, a build that imports rows an older program applied adds an `Imported migrator ledger rows` record (`migrator_table`, `imported_count`), and a migration found already applied by another process during the run logs `Imported migration` (`migration_id`, `migration_name`) instead of `Running migration`. `Cache` versions its own schema through the same engine, so it emits the same records. Raise the minimum log level to `Debug` to see them.

### Adopting a database migrated by effect's Migrator

`Store` keeps its own ledger, `_store_migrations`. A database previously migrated by effect/sql's `Migrator` (`SqliteMigrator.layer` and friends) recorded its history in `effect_sql_migrations` instead, so a `Store` opened over it sees an empty ledger and re-runs every migration — a bare `CREATE TABLE` then fails. Opt in to adopting that history:

```ts
const StoreLive = Store.layerSqlite({
  filename: "data.db",
  migrations, // { id: 1, name: "initial", up: … }, { id: 2, name: "test_artifacts", up: … }, …
  adoptMigratorLedger: true, // or { table: "my_migrations" } for a non-default Migrator table
});
```

Adoption is **one-shot, decided by the first layer build that has the option on**. That build — after the ledger is ensured, before pending migrations run, in one write-locked transaction — copies every foreign row into `_store_migrations` **if** `_store_migrations` is empty and the foreign table exists, and in every case records that the decision was made in a `_store_meta` table, in the same transaction. Migrations above the adopted ones then apply as usual. Every later build sees the marker and skips adoption, so the option is safe to leave on — including after `rollback(0)`: the marker survives the rollback, so a reopen re-applies every migration from scratch instead of re-adopting history the rollback unwound. The foreign table is read, never written. A failed adoption records nothing, marker included, and is retried on the next build. A database the Migrator never touched builds exactly as it would without the option, plus the marker. Adoption **honours rollback history**. A `Store` that ran without the option and then rolled back leaves a tombstone per unwound id, and each foreign row is judged against it. A row unchanged since that rollback is stale history: it is not adopted, and its migration runs again. A row changed or written since is adopted. A row for a foreign table the rollback did not track is refused, typed. Turning the option on after such a rollback is therefore safe.

Matching is exact, and any disagreement fails the layer with `StoreError` (`operation: "adopt"`) before anything is recorded or applied:

- **Every foreign row needs a migration with the same `id` and `name`.** effect/sql's loaders strip the numeric key prefix before recording: `fromRecord`'s `"0001_initial"` is stored as id `1`, name `"initial"`. So the matching `StoreMigration` is `{ id: 1, name: "initial" }` — not `"0001_initial"`.
- **Every migration at or below the foreign ledger's highest id must have a foreign row.** effect/sql only ever runs ids above its latest, so a lower id it never recorded was never applied; running it now would diverge from the history the database actually has. Renumber it above the high-water mark instead.

Each adopted row's `created_at` becomes its `appliedAt`. A zone-less value — SQLite's `current_timestamp` text (`2026-10-03 12:00:00`) or `2026-10-03T12:00:00` — is read as UTC; a value that cannot be read as a date fails the layer with the same typed `StoreError`. The option lives on `StoreOptions`, so it works through `layer`, `layerSqlite` and `@effected/app`'s `AppStore` layers alike, but adoption is **SQLite only**: on any other dialect the option fails the layer with `StoreError` (`operation: "adopt"`).

### Several versions sharing one database: mirroring the Migrator ledger

Adoption covers an old database opened by a new program. The reverse needs its own option: when an **older** program that still migrates through effect/sql's `Migrator` opens a database the new program created, it finds `effect_sql_migrations` empty and re-runs its first migration. While several versions share one file, keep both ledgers in step:

```ts
const StoreLive = Store.layerSqlite({
  filename: "registry.db",
  migrations, // { id: 1, name: "initial", up: … } — the prefix-stripped names
  adoptMigratorLedger: true, // old history in, once
  mirrorMigratorLedger: true, // new history out, on every apply and rollback
});
```

The mirror is **two-way for matching rows**: an older program may migrate the shared file forward between this program's opens, and what it applied must be imported, never re-run.

- **Every layer build** creates `effect_sql_migrations` with effect/sql's own SQLite DDL if it is absent. It **imports** every foreign row `_store_migrations` lacks that matches a migration by id and name, then copies out every `_store_migrations` row the foreign table lacks, so the two ledgers end equal.
- **Every apply** first checks the foreign table inside the migration's own write-locked transaction. An id an older program recorded since this one planned is imported, not re-run, so concurrent old and new openers are safe too. Otherwise it inserts the `(migration_id, name)` row in the same transaction as the migration. **Every rollback** deletes the row in the same transaction.
- **Import follows adoption's rules** and refuses, typed, a foreign row whose id has no migration, a name mismatch, an unreadable `created_at`, or a known migration below the imported high-water mark that neither ledger records.
- **Rollbacks leave history, mirror on or off.** Every `rollback` tombstones the unwound ids in `_store_meta`, recording each foreign ledger's row as the rollback left it. A Store without the mirror can therefore roll back a database another opening mirrors without inviting a phantom. On the next mirrored build, a foreign row unchanged since the rollback is stale and its migration runs again. A row an older program wrote after the rollback is imported. A table the rollback never snapshotted is refused, typed, rather than guessed. Foreign rows are never deleted by a Store without the option; that ledger belongs to the older program. effect/sql's `Migrator` runs every id above its highest recorded one, so after `rollback(n)` the older program re-applies what was unwound, just as a `Store` reopen would.
- **With adoption**, both options default to the same table, which is the intended pairing: adoption runs first and copies the old history in once; mirroring keeps writing it.
- **Names** are written as `StoreMigration.name`, the prefix-stripped form effect/sql records. effect/sql itself compares ids only.

SQLite only: on any other dialect the option fails the layer with `StoreError` (`operation: "setup"`).

### Several processes opening one database

Processes that open the same file at once — parallel CLI hooks, a server beside a CLI — each run the pending-migration check, and none of them runs an `up` twice. Each migration commits in its own transaction, and that transaction re-checks the ledger before running `up`. On SQLite the driver starts it with `BEGIN IMMEDIATE`, taking the write lock before the check, so the losing process waits (up to `client.busyTimeout`) and then skips the migration the winner already applied. That guarantee rests on the driver's transaction taking a write lock; it holds for `layerSqlite`, and for `Store.layer` only over a driver whose transactions do the same.

**One limit sits below `Store`, in the SQLite driver: the very first open of a brand-new file.** `SqliteClient` sets `PRAGMA busy_timeout` and then `PRAGMA journal_mode = WAL` on every connection. Switching a fresh file from its default journal into WAL needs a lock that SQLite refuses at once under contention, without waiting out `busy_timeout`. When several processes create the same file at the same moment, some of them fail with `database is locked`. The driver issues the pragma outside any error channel, so that failure surfaces as a **defect** from the layer build, not as a typed error. Once the file is in WAL mode the pragma has nothing left to switch and never contends, so only the first open is exposed. Two mitigations work today:

- **Create the file in WAL mode once, from a single process,** before anything opens it concurrently — an install or setup step, or whichever command is known to run first. After that, every concurrent opener is safe.
- **Warm the database up first, retrying only that open.** Build the layer once inside its own scope and retry that build on `SQLITE_BUSY`, with jittered backoff — an immediate retry is not enough, because the contenders collide again in lockstep. Then run the program normally:

```ts
import { Data, Effect, Layer, Schedule } from "effect";

class DatabaseBusy extends Data.TaggedError("DatabaseBusy")<{ readonly defect: unknown }> {}

/** SQLITE_BUSY as node:sqlite throws it: a plain Error carrying the extended fields. */
const isSqliteBusy = (defect: unknown): boolean =>
  defect instanceof Error &&
  (defect as { readonly code?: unknown }).code === "ERR_SQLITE_ERROR" &&
  (defect as { readonly errcode?: unknown }).errcode === 5;

// Open — and close — the database once, retrying ONLY that open.
const warmUp = Effect.scoped(Layer.build(StoreLive)).pipe(
  Effect.catchDefect((defect) => (isSqliteBusy(defect) ? Effect.fail(new DatabaseBusy({ defect })) : Effect.die(defect))),
  Effect.retry({
    times: 8,
    while: (error) => error._tag === "DatabaseBusy",
    schedule: Schedule.jittered(Schedule.exponential("20 millis")),
  }),
);

// The program runs once, unretried, over its own build of the layer.
const main = warmUp.pipe(Effect.andThen(program.pipe(Effect.provide(StoreLive))));
```

Only the warm-up is retried, so a program that has already done work never re-runs, and only `SQLITE_BUSY` is retried — a failing migration still fails once, typed. The warm-up does **not** stand in for the program's own open: `Effect.provide` builds the layer again, a second connection, because separate provides do not share a memoised build. That second open cannot hit the first-open refusal, since the warm-up left the file in WAL mode. A `SQLITE_BUSY` there means a writer outlasted `busyTimeout`, and it is deliberately not retried.

### Connection settings: WAL, busy timeout, foreign keys and `onConnect`

`SqliteClient` opens one serialized connection per layer build and configures it itself: `journal_mode = WAL` unless `client.disableWAL` is set, and `busy_timeout` from `client.busyTimeout` (default five seconds). Both are per-connection settings, so set them through `client` — never inside a migration, which runs once per database rather than once per connection:

```ts
const StoreLive = Store.layerSqlite({ filename: "data.db", migrations, client: { busyTimeout: "10 seconds" } });
```

**Foreign keys are already enforced.** `node:sqlite` opens every connection with `foreign_keys = 1`, and the driver keeps it, so a `REFERENCES … ON DELETE RESTRICT` constraint holds without any setup.

For a per-connection setting `client` cannot carry, pass `onConnect`. It runs once against the freshly opened connection, before the ledger is ensured, before adoption and before any migration, and outside any transaction, which matters for pragmas SQLite ignores inside one. One connection per build means once per build is once per connection. A failure fails the layer as `StoreError` (`operation: "setup"`). `Cache.layerSqlite` takes the same option, failing as `CacheError` (`operation: "setup"`):

```ts
const StoreLive = Store.layerSqlite({
  filename: "data.db",
  migrations,
  onConnect: (sql) => sql`PRAGMA synchronous = NORMAL`,
});
```

### More than one database

`Store` and `Cache` are single service tags. An application with a second database declares its own key over the same shape and builds it with `layerSqliteAs`:

```ts
import { Cache, Store } from "@effected/store";
import type { CacheShape, StoreShape } from "@effected/store";
import { Context } from "effect";

class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}
class TarballCache extends Context.Service<TarballCache, CacheShape>()("myapp/TarballCache") {}

// Every one bound once, to a const.
const RegistryStoreLive = Store.layerSqliteAs(RegistryStore, { filename: "/data/registry.db", migrations });
const TarballCacheLive = Cache.layerSqliteAs(TarballCache, { filename: "/cache/tarballs.db" });
```

Code written against the bare `SqlClient` — an existing repository layer — gets a keyed store's client through `Store.sqlClient(tag)`. Provide it to those layers alone, with `Layer.provide`, since a second `SqlClient` merged beside it would shadow it:

```ts
const RegistrySql = Store.sqlClient(RegistryStore).pipe(Layer.provide(RegistryStoreLive));
const RegistryRepo = RegistryRepoLive.pipe(Layer.provide(RegistrySql)); // RegistryRepoLive needs SqlClient
```

The output is the key alone — the `Store` or `Cache` built inside is never exposed — so a keyed layer composes beside a primary one without shadowing it, each file with its own ledger. The key's service type must be `StoreShape` / `CacheShape`: an incompatible shape is a compile error, and so is one that adds members (`StoreShape & { … }`), reported as an argument not assignable to `never` since the layer could not supply them. The check cannot see through method-syntax parameter bivariance: a member redeclared as a method with a wider parameter still compiles.

## Cache

`Cache` stores bytes under string keys, with an optional TTL and a set of tags for bulk invalidation:

```ts
import { Cache } from "@effected/store";
import { Duration, Effect } from "effect";

const CacheLive = Cache.layerSqlite({ filename: "cache.db", maxEntries: 1000 });

const program = Effect.gen(function* () {
  const cache = yield* Cache;

  yield* cache.set({
    key: "npm:effect",
    value: new TextEncoder().encode(`{"name":"effect"}`),
    contentType: "application/json",
    tags: ["npm", "registry"],
    ttl: Duration.minutes(10),
  });

  const hit = yield* cache.get("npm:effect");
  // Option.some(CacheEntry) while the entry is live; Option.none() once the TTL has passed

  return yield* cache.invalidateByTag("npm");
  // { count: 1, keys: [ "npm:effect" ] }
});

Effect.runPromise(program.pipe(Effect.provide(CacheLive))).then(console.log);
```

The invariants worth knowing:

- **Expiry is lazy.** `get` and `has` delete an expired row on read; `prune` sweeps in bulk. The clock is read through `DateTime.now`, so `TestClock` drives expiry deterministically in tests — provide `TestClock.layer()` **outside** the `Effect.provide` that supplies the cache, never beneath it, or the test body has no `TestClock` in its context, `TestClock.adjust` dies as a defect, and nothing you try to expire ever expires.
- **Eviction is least-recently-*written***, not LRU-read. With `maxEntries` set, a `set` evicts the oldest-written entries in the same transaction until the bound holds, and publishes an `Evicted` event.
- **`onRemoved` runs inside the delete transaction.** `invalidate`, `invalidateByTag`, `invalidateAll` and `prune` each take an optional callback that runs before the delete commits: a typed failure rolls the delete back and suppresses the event, and your error type survives in the signature as `CacheError | E`. This is how you keep a cache entry and the file it points at from drifting apart.
- **Keys and tags are data, never SQL.** Everything reaches SQLite through the tagged-template `SqlClient`, and tag matching escapes `%`, `_` and `\` before it interpolates, so a tag containing a backslash matches its own entries.

### Degrading to a miss

A cache that cannot be constructed fails its layer, and that failure belongs to the whole program. `Cache.degrading` wraps any `Cache` layer so a construction failure yields a working, empty cache instead: reads miss, writes are discarded, removals report nothing removed, no operation can fail, and the cause is logged once at warning level.

```ts
import { Cache } from "@effected/store";
import { Effect } from "effect";

const CacheLive = Cache.degrading(Cache.layerSqlite({ filename: "cache.db" }));

const program = Effect.gen(function* () {
  const cache = yield* Cache;
  return cache.degraded;
  // false for a live cache; true when construction failed and this is the fallback
});
```

It is opt-in because the opposite posture is legitimate — a consumer that wants a cache problem to be fatal, or that wants the narrower per-operation form, keeps exactly that by not calling it. Two details make it worth having rather than hand-writing. The SQLite driver reports construction failures — a `filename` whose parent directory does not exist, the common case — as *defects* rather than typed failures, so a failure-only catch misses the case this exists for. And interruption is deliberately re-raised with its interrupting fiber intact, because a caller shutting down is not a broken cache. `degraded` is a plain field rather than a `CacheEvent` because degradation is decided at construction, before any subscriber exists, and the events hub does not replay.

### Read-through, in one call

The loop above — get, decode, fetch on a miss, encode, set — is the entire reason to have a cache, so it is a single call rather than twenty-five lines in every consumer:

```ts
import { Cache } from "@effected/store";
import { Effect, Schema } from "effect";

const Members = Schema.Struct({ login: Schema.String });

const program = Effect.gen(function* () {
  const members = yield* Cache.through("team:platform", Schema.fromJsonString(Members), {
    ttl: "1 hour",
    tags: ["team"],
  })(fetchMembersFromApi); // ← only runs on a miss

  return members;
});
```

`schema` encodes to `string`; the last step to bytes is [`Uint8ArrayFromUtf8`](#uint8arrayfromutf8), so the encoding decision lives in one audited place instead of one per consumer. Use `Cache.throughVerbose` when the caller needs to know where the value came from — it returns `{ value, hit }`, which is what you want for printing *(cached)* next to a line of output. The `CacheEvent` PubSub is the right channel for telemetry and the wrong one for a fact the read-through already knew.

Two policies this makes the package's rather than yours:

- **A value that fails to decode is a miss, not a failure.** Those bytes were written by an older build of your own program: the user did not cause it, cannot fix it without knowing the cache exists, and everything in here is re-derivable by definition. Failing would strand them behind a cache they cannot see. The stale entry is overwritten on the way out.
- **`CacheError` is surfaced, not swallowed.** A cache is additive, and you may well want to push through a broken one — but that is your call to make with `Effect.catchTag("CacheError", …)`, because a database that cannot be read is a real and reportable condition. This package will not hide it from you by default.

### Uint8ArrayFromUtf8

Cache values are bytes, and the honest way to produce them is a schema. Core ships `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and `Uint8ArrayFromHex` — and nothing for UTF-8, so `Schema.fromJsonString(schema)` gets you to `string` and stops one inch short. `Uint8ArrayFromUtf8` is that inch:

```ts
const Payload = Schema.fromJsonString(Settings).pipe(Schema.encodeTo(Uint8ArrayFromUtf8));
```

Encoding **fails** on malformed UTF-8 rather than substituting replacement characters, so a corrupt value stays distinguishable from a valid one that happens to contain `U+FFFD`. If core ever ships an equivalent, prefer that one.

Every operation publishes to `cache.events`, an unbounded `PubSub<CacheEvent>` — `Hit`, `Miss`, `Set`, `Expired`, `Evicted`, `Invalidated`, `InvalidatedByTag`, `InvalidatedAll` and `Pruned`. It is unbounded on purpose: a slow subscriber must never backpressure a cache write.

## Errors

| Tag | Means | Recovery |
| --- | --- | --- |
| `StoreError` | Its `message` reads `Store <operation> failed: <reason>`, folding in the cause's message — for a SQL failure, the database's own text (`UNIQUE constraint failed: t.id`), never a bound value. A store operation's own SQL failed — ledger bookkeeping, or the queries around a migration — or (`operation: "adopt"`) an adopted Migrator ledger disagrees with your migration list. Carries `operation` and the structural `cause`. | Usually fatal; report the operation and the cause. An `adopt` failure's cause names the mismatched migration. |
| `StoreMigrationError` | A user-supplied migration failed with a typed `SqlError`. Carries `direction`, `id`, `name` and the structural `cause`. | Report which migration and which direction; the ledger is left consistent. |
| `CacheError` | A cache operation's SQL failed. Carries `operation`, an optional `key` and the structural `cause`. | A cache is a cache — falling back to the origin is usually right. |

Defects are not errors here. A throwing migration callback, a throwing `onRemoved`, a `maxEntries` that is not a positive integer: all of those are programmer mistakes and stay on the defect channel where they belong.

## Features

- `Store` — a migrated `SqlClient` with `migrate`, `rollback`, `status` and the raw `client` for your own schema-aware queries.
- `Cache` — TTL, tags, bulk invalidation, a `maxEntries` eviction policy and a `CacheEvent` stream, over `key → Uint8Array`.
- `Cache.degrading` — an opt-in layer combinator that turns a construction failure into a working, empty cache; the `degraded` field on the service tells the two apart.
- `layer` / `layerSqlite` / `layerTest` on both — driver-agnostic, batteries-included and in-memory, with the same options.
- `layerSqliteAs` on both — a second database under a service key you define, never shadowing the primary.
- `adoptMigratorLedger` — move a live database off effect/sql's `Migrator` without re-running its history.
- `mirrorMigratorLedger` — keep effect/sql's ledger in step while older versions still open the same database.
- `onConnect` — a per-connection hook, run before the ledger and outside any transaction.
- `Store.sqlClient` — a keyed store's client as the bare `SqlClient`.
- `StoreError`, `StoreMigrationError`, `CacheError` — tagged errors carrying the underlying `SqlError` structurally, never a `reason` string.
- `CacheEntry`, `CacheEntryMeta`, `CacheRemovalResult`, `StoreMigrationStatus` — the returned records; `entries` lists metadata without loading BLOBs.
- Named spans on every public fallible method (`Store.migrate`, `Cache.get`, …), nesting over the driver's own statement spans.

## License

[MIT](LICENSE)
