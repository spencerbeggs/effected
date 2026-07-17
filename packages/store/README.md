# @effected/store

[![npm](https://img.shields.io/npm/v/@effected%2Fstore?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/store)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Durable local state for Effect: two services over one primitive. `Store` is a schema-versioned, migrated `SqlClient` — a managed database connection with a user-defined migration ledger that supports `up`, `down`, rollback and a status projection. `Cache` is a `key → Uint8Array` cache with TTL, tags, bulk invalidation, an eviction policy and a `PubSub` of lifecycle events. Both run on SQLite through Node's built-in `node:sqlite`, so there is no native compile step, and both surface their failures as tagged errors that carry the underlying `SqlError` structurally.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
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

The SQL core lives in `effect` itself, under `effect/unstable/sql` — there is no `@effect/sql` package on the v4 line, so `SqlClient` is imported from `effect/unstable/sql/SqlClient`.

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

- **Expiry is lazy.** `get` and `has` delete an expired row on read; `prune` sweeps in bulk. The clock is read through `DateTime.now`, so `TestClock` drives expiry deterministically in tests.
- **Eviction is least-recently-*written***, not LRU-read. With `maxEntries` set, a `set` evicts the oldest-written entries in the same transaction until the bound holds, and publishes an `Evicted` event.
- **`onRemoved` runs inside the delete transaction.** `invalidate`, `invalidateByTag`, `invalidateAll` and `prune` each take an optional callback that runs before the delete commits: a typed failure rolls the delete back and suppresses the event, and your error type survives in the signature as `CacheError | E`. This is how you keep a cache entry and the file it points at from drifting apart.
- **Keys and tags are data, never SQL.** Everything reaches SQLite through the tagged-template `SqlClient`, and tag matching escapes `%`, `_` and `\` before it interpolates, so a tag containing a backslash matches its own entries.

Every operation publishes to `cache.events`, an unbounded `PubSub<CacheEvent>` — `Hit`, `Miss`, `Set`, `Expired`, `Evicted`, `Invalidated`, `InvalidatedByTag`, `InvalidatedAll` and `Pruned`. It is unbounded on purpose: a slow subscriber must never backpressure a cache write.

## Errors

| Tag | Means | Recovery |
| --- | --- | --- |
| `StoreError` | A store operation's own SQL failed — ledger bookkeeping, or the queries around a migration. Carries `operation` and the structural `cause`. | Usually fatal; report the operation and the cause. |
| `StoreMigrationError` | A user-supplied migration failed with a typed `SqlError`. Carries `direction`, `id`, `name` and the structural `cause`. | Report which migration and which direction; the ledger is left consistent. |
| `CacheError` | A cache operation's SQL failed. Carries `operation`, an optional `key` and the structural `cause`. | A cache is a cache — falling back to the origin is usually right. |

Defects are not errors here. A throwing migration callback, a throwing `onRemoved`, a `maxEntries` that is not a positive integer: all of those are programmer mistakes and stay on the defect channel where they belong.

## Features

- `Store` — a migrated `SqlClient` with `migrate`, `rollback`, `status` and the raw `client` for your own schema-aware queries.
- `Cache` — TTL, tags, bulk invalidation, a `maxEntries` eviction policy and a `CacheEvent` stream, over `key → Uint8Array`.
- `layer` / `layerSqlite` / `layerTest` on both — driver-agnostic, batteries-included and in-memory, with the same options.
- `StoreError`, `StoreMigrationError`, `CacheError` — tagged errors carrying the underlying `SqlError` structurally, never a `reason` string.
- `CacheEntry`, `CacheEntryMeta`, `CacheRemovalResult`, `StoreMigrationStatus` — the returned records; `entries` lists metadata without loading BLOBs.
- Named spans on every public fallible method (`Store.migrate`, `Cache.get`, …), nesting over the driver's own statement spans.

## License

[MIT](LICENSE)
