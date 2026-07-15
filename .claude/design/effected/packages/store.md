---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - config-file.md
  - app.md
---

# @effected/store design

## Overview

`@effected/store` is durable local state for Effect applications: two services over one primitive, and the kit's only **integrated-tier** package.

- **`Store`** — a schema-versioned, migrated `SqlClient`: a managed database connection with a user-defined migration ledger.
- **`Cache`** — a key → `Uint8Array` cache with TTL, tags, an eviction policy and a `CacheEvent` PubSub.

The two are genuinely different services, not one with a flag: an evicted cache entry is correct behaviour; a lost state row is a bug. The shared primitive is the migration-ledger engine in `src/internal/migrator.ts` — `Store` exposes it with user-supplied migrations; `Cache` uses it privately to version its own fixed schema.

XDG concepts (`AppDirs`, resolvers) are **out of scope** and supply the database *path* from elsewhere: every layer takes a `filename` (or an abstract `SqlClient`), so `@effected/xdg` and `@effected/app` wire `AppDirs → filename` without store knowing.

## The v4 SQLite decision

The abstract seam is `SqlClient` from `effect/unstable/sql`; the concrete driver is `@effect/sql-sqlite-node`. The SQL core (`SqlClient`, `Statement`, `SqlError`, transactions) lives in `effect` itself under `effect/unstable/sql/*` — there is no `@effect/sql` package on the v4 line. `@effect/sql-sqlite-node` is published on the same version train as `effect`, peers on `effect` alone, and is implemented over Node's built-in `node:sqlite` — no native compile step, no `better-sqlite3`, no transitive peers.

Two facts are load-bearing:

- **`effect/unstable/sql` is an unstable namespace upstream.** The whole repo pins one catalog version and nothing publishes before `0.1.0`, so surface drift is caught at catalog bumps, not by consumers.
- **`SqliteClient.layer` has no error channel.** Driver construction failures — chiefly a `filename` whose parent directory does not exist — arrive as **defects**, not typed failures, which is why `layerSqlite`/`layerTest` publish only the domain error in `E` (see [Error handling](#error-handling)). A package wiring a database path must ensure the directory exists *before* the layer is built; nothing downstream can catch it typed.

Core's own `effect/unstable/sql/Migrator` is **not** used: it is forward-only (no `down`, no rollback, no status projection) and Store's contract carries all three. The internal engine owns its ledger table shape.

## Tier and dependencies

**Integrated tier** by [R1](../effect-standards.md#dependency-policy): the runtime dependency on `@effect/sql-sqlite-node` is what makes it tier 3, and consumers are tier 3 by [R2](../effect-standards.md#dependency-policy) — which is why the sqlite services were split out of `@effected/xdg`, keeping xdg boundary tier.

- `peerDependencies`: `effect`.
- `dependencies`: `@effect/sql-sqlite-node` — a regular dependency. Its only peer is `effect`, which store already declares, so the peer closure is complete by construction. No store type signature exposes a `SqliteClient` type; the driver appears only inside the `layerSqlite`/`layerTest` convenience layers.
- No `@effected/*` edges, so no `prepare` script.

The core layers (`Store.layer`, `Cache.layer`) require an abstract `SqlClient` in `R`, so any v4 driver satisfies them; the sqlite dependency funds the batteries-included layers only.

## Module layout

Module-per-concept:

```text
packages/store/
  src/
    Store.ts        # StoreMigration, StoreMigrationResult, StoreMigrationStatus,
                    # StoreError, StoreMigrationError, Store service + layer/layerSqlite/layerTest
    Cache.ts        # CacheEntry, CacheEntryMeta, CacheRemovalResult, CacheEvent(+Payload),
                    # CacheError, Cache service + layer/layerSqlite/layerTest
    index.ts        # public surface, re-exports only
    internal/
      migrator.ts   # the shared primitive: ledger engine over SqlClient
  __test__/
    Store.test.ts
    Cache.test.ts
```

`internal/migrator.ts` is parameterized by ledger **table name**: `Store` uses `_store_migrations`, `Cache` uses `_cache_migrations`. Two ledgers let a Store and a Cache share one database file without id collisions, and the cache schema is itself versioned. The engine defines its own record types and imports nothing from the facades (`noImportCycles` is error-level).

## Public surface

### Store

```ts
interface StoreMigration {
  readonly id: number;      // positive integer, unique across the list
  readonly name: string;
  readonly up: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError>;
  readonly down?: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, SqlError>;
}

interface StoreMigrationResult {
  readonly applied: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly rolledBack: ReadonlyArray<{ readonly id: number; readonly name: string }>;
}

class StoreMigrationStatus extends Schema.Class ... ({
  id: Schema.Number, name: Schema.String,
  appliedAt: Schema.optionalKey(Schema.DateTimeUtc),  // absent = pending
}) {}

interface StoreShape {
  readonly client: SqlClient.SqlClient;
  readonly migrate: Effect.Effect<StoreMigrationResult, StoreError | StoreMigrationError>;
  readonly rollback: (toId: number) => Effect.Effect<StoreMigrationResult, StoreError | StoreMigrationError>;
  readonly status: Effect.Effect<ReadonlyArray<StoreMigrationStatus>, StoreError>;
}

class Store extends Context.Service<Store, StoreShape>()("@effected/store/Store") {
  static layer(options: StoreOptions): Layer<Store, StoreError | StoreMigrationError, SqlClient>;
  static layerSqlite(options: StoreOptions & { filename: string }): Layer<Store, StoreError | StoreMigrationError>;
  static layerTest(options: StoreOptions): Layer<Store, StoreError | StoreMigrationError>;  // :memory:
}
```

`up`/`down` return `Effect<unknown, SqlError>`, not `Effect<void, …>`. A `SqlClient` tagged template resolves to the statement's *rows*, so a `void` return type would force every consumer to pipe an `Effect.asVoid` onto an otherwise self-describing ``sql`CREATE TABLE …` ``. The engine discards the value either way, so the wider return type lets a migration be the statement itself.

Layer construction ensures the ledger table and **runs all pending migrations**, surfacing construction failures on the layer's typed error channel. `migrate` re-applies after a `rollback`; `status` projects the full list with per-migration `appliedAt`. `rollback(toId)` rolls back applied migrations with `id > toId` in descending order, invoking `down` where defined (a migration without `down` is skipped over, its ledger row still removed). A migration callback that **throws** is a programmer bug and stays a defect, per the [hardening callback rule](../effect-standards.md#error-handling-standards).

### The layer trio

Both services publish the same three statics, and the split is the seam: `layer` is driver-agnostic (it requires an abstract `SqlClient` in `R`, so any Effect SQL driver satisfies it), `layerSqlite` provides the sqlite driver itself and `layerTest` is `layerSqlite` at `:memory:`. Only the two `*Sqlite` layers name the driver, which is what keeps `@effect/sql-sqlite-node` out of every store type signature.

**The memoization trap.** These statics are *parameterized factories*, not layer values: each call builds a new `Layer`, and Effect memoizes layers **by reference**. Calling `Store.layerSqlite({...})` inline at two provide sites opens the database **twice** — two connections onto one file, two ledger setups, and (for `Cache`) two independent PubSubs whose subscribers each see half the events. Bind the result to a `const` once and reuse that binding. Every package wiring a layer over a path (`xdg`, `app`) inherits this discipline.

### Cache

```ts
class CacheEntry extends Schema.Class ... ({
  key: Schema.String,
  value: Schema.Uint8Array,
  contentType: Schema.String,            // default "application/octet-stream"
  tags: Schema.Array(Schema.String),
  created: Schema.DateTimeUtc,
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),   // absent = never expires
  sizeBytes: Schema.Number,
}) {}

interface CacheEntryMeta { /* CacheEntry minus value; entries() never loads BLOBs */ }
interface CacheRemovalResult { readonly count: number; readonly keys: ReadonlyArray<string> }

const CacheEventPayload = Schema.Union([
  Schema.TaggedStruct("Hit", { key }), Schema.TaggedStruct("Miss", { key }),
  Schema.TaggedStruct("Set", { key, sizeBytes, tags }),
  Schema.TaggedStruct("Expired", { key }),
  Schema.TaggedStruct("Evicted", { count, keys }),          // maxEntries eviction
  Schema.TaggedStruct("Invalidated", { key }),
  Schema.TaggedStruct("InvalidatedByTag", { tag, count, keys }),
  Schema.TaggedStruct("InvalidatedAll", { count, keys }),
  Schema.TaggedStruct("Pruned", { count, keys }),
]);
class CacheEvent extends Schema.Class ... ({ timestamp: Schema.DateTimeUtc, event: CacheEventPayload }) {}

interface CacheShape {
  readonly get: (key: string) => Effect<Option<CacheEntry>, CacheError>;
  readonly set: (params: {
    readonly key: string; readonly value: Uint8Array;
    readonly contentType?: string; readonly tags?: ReadonlyArray<string>;
    readonly ttl?: Duration.Duration;                       // overrides defaultTtl
  }) => Effect<void, CacheError>;
  readonly has: (key: string) => Effect<boolean, CacheError>;
  readonly entries: Effect<ReadonlyArray<CacheEntryMeta>, CacheError>;
  readonly invalidate: <E = never, R = never>(key: string, onRemoved?: () => Effect<void, E, R>) =>
    Effect<void, CacheError | E, R>;
  readonly invalidateByTag: <E = never, R = never>(tag: string, onRemoved?: (r: CacheRemovalResult) => Effect<void, E, R>) =>
    Effect<CacheRemovalResult, CacheError | E, R>;
  readonly invalidateAll: <E = never, R = never>(onRemoved?: (r: CacheRemovalResult) => Effect<void, E, R>) =>
    Effect<CacheRemovalResult, CacheError | E, R>;
  readonly prune: <E = never, R = never>(onRemoved?: (r: CacheRemovalResult) => Effect<void, E, R>) =>
    Effect<CacheRemovalResult, CacheError | E, R>;
  readonly events: PubSub.PubSub<CacheEvent>;
}

interface CacheOptions {
  readonly defaultTtl?: Duration.Duration;   // applied when set() passes no ttl
  readonly maxEntries?: number;              // positive integer; absent = unbounded
}

class Cache extends Context.Service<Cache, CacheShape>()("@effected/store/Cache") {
  static layer(options?: CacheOptions): Layer<Cache, CacheError, SqlClient>;
  static layerSqlite(options: CacheOptions & { filename: string }): Layer<Cache, CacheError>;
  static layerTest(options?: CacheOptions): Layer<Cache, CacheError>;   // :memory:
}
```

Behavioural contract:

- **`CacheEntryMeta` carries `DateTime.Utc` fields**, not raw ISO strings.
- **The transactional `onRemoved` contract**: the callback runs inside the delete transaction, a typed failure rolls the delete back and suppresses the event, and the caller's `E` survives in the signature (`CacheError | E`). A callback that *throws* propagates as a defect, never laundered into `CacheError`.
- **Lazy expiry**: `get`/`has` delete an expired row on read (`Expired` then `Miss` events); `prune` sweeps in bulk. Expiry reads the clock via `DateTime.now`, so `TestClock` drives it deterministically.
- **Eviction policy**: with `maxEntries` set, `set` evicts the oldest-*written* entries (lowest `rowid` — `INSERT OR REPLACE` re-mints the rowid, so rowid order is write order) until the count is back at the bound, emitting one `Evicted` event. Least-recently-**set**, not LRU-read: deterministic and index-free. A byte-budget policy (`maxSizeBytes`) is deferred until a consumer asks.

**The `invalidateByTag` encoding rule.** Tags are stored as one `JSON.stringify`'d array in a TEXT column. Matching a tag builds the `LIKE` pattern from the **JSON-encoded** tag (not the raw tag), escapes the `LIKE` metacharacters (`%`, `_`, `\`) and passes an explicit `ESCAPE` clause, with a hostile-tag test. A pattern built from the raw tag can never match its own entry when the tag contains a backslash or double quote. The escaped pattern still reaches SQLite as a *parameter*, so nothing is hand-concatenated into SQL. The general lesson for any package storing structured data in a text column: **compare in the encoded domain, or decode before comparing — never mix the two.**

### Events

`events` stays on the cache shape rather than a separate opt-in service: cache events are intrinsic per-instance observability for an eviction-bearing store, and the PubSub is created with the service, unbounded so a slow subscriber never backpressures a cache write. `emit` is infallible (`DateTime.now` + `PubSub.publish`). Events are a consumer hook, not the package's telemetry — spans are (see [Observability](#observability)).

## Relationship to core persistence

Core's `effect/unstable/persistence/KeyValueStore` is the plain-KV subset of this package's noun (`layerMemory`, `layerFileSystem`, a SQLite-backed `layerSql`, `SchemaStore`, `prefix`). The overlap is partial: `KeyValueStore` has no TTL, no tag invalidation, no eviction policy, no event stream and no reversible migration ledger — the value-add that justifies `Cache` and `Store`. Two binding consequences: any future surface here that drops that value-add (a plain durable KV) is a reinvention — point the consumer at core's `KeyValueStore` instead; and if this package ever grows request-level durable caching, core's `PersistedCache`/`Persistence` own that shape — build on them, not beside them.

## Error handling

Three `Schema.TaggedErrorClass` types with a structural `cause: Schema.Defect()`:

| Error | Fields | Raised by | Audience |
| --- | --- | --- | --- |
| `StoreError` | `operation` (`Literals(["setup", "migrate", "rollback", "status"])`), `cause` | ledger/SQL failures in Store ops | calling code, operator |
| `StoreMigrationError` | `direction` (`Literals(["up", "down"])`), `id`, `name`, `cause` | a user migration failing | calling code — `id`/`name`/`direction` are what a caller needs to report or repair |
| `CacheError` | `operation` (literal union of the cache ops), `key` (`optionalKey`), `cause` | SQL failures in Cache ops | calling code, operator |

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`SqlError` is wrapped, never leaked** — it lands structurally in `cause`, and each class derives a human `message` from its typed fields.
- **No defect laundering.** Only typed failures (`SqlError`) are mapped into the domain error; defects — including a throwing `onRemoved` or migration callback — propagate as defects (`withTransaction` still rolls back on them).
- **Wiring errors are construction defects**: duplicate or non-positive-integer migration `id`s, and a `maxEntries` that is not a positive integer, die at layer construction with a message naming the bad value. The [NaN guard](../effect-standards.md#input-hardening-standards) applies — the check is `Number.isInteger(n) && n >= 1`, never a bare `< 1`. `rollback(toId)` likewise dies on a non-integer or negative `toId`.
- A bad `filename` (missing parent directory) is a wiring defect from the driver; the caller wiring the path ensures the directory exists.

## Observability

Every public fallible method is a named `Effect.fn` span: `Store.migrate`, `Store.rollback`, `Store.status`, `Cache.get`, `Cache.set`, `Cache.has`, `Cache.entries`, `Cache.invalidate`, `Cache.invalidateByTag`, `Cache.invalidateAll`, `Cache.prune`. `store.client` is a value, not an operation — no span. No metrics, no hot-path logging; telemetry-agnostic. The `SqlClient` layer beneath annotates statement spans with `db.system.name`, so store spans nest over driver spans for free.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suites in `__test__/Store.test.ts` and `__test__/Cache.test.ts`. `layerTest` (`:memory:`) provides hermetic databases; groups provision via top-level `layer(...)` where the fixture allows.

Mutation-prone edges the suite pins:

- **Store**: fresh-db construction applies all migrations in `id` order (ids supplied out of order — the sort is observable); a second construction over the same file applies nothing; `rollback(toId)` runs `down` in descending order and stops *at* `toId` (a boundary test with the target beyond one migration); `migrate` re-applies after rollback; `status` distinguishes applied/pending; a failing `up` surfaces `StoreMigrationError` with the right `id`/`direction` and leaves prior migrations applied; a *throwing* `up` stays a defect.
- **Cache**: set/get round-trip including BLOB fidelity and tags; miss on absent key; TTL expiry driven by `TestClock.adjust`; `prune` removes only expired rows; `defaultTtl` applies when `set` omits `ttl`, and `ttl` overrides it; `maxEntries` eviction evicts the oldest-written keys and emits `Evicted`; `invalidate` skips `onRemoved` when the key is absent; a failing `onRemoved` rolls back the delete and suppresses the event; the caller's `E` survives; a throwing `onRemoved` is a defect; event-stream ordering via `PubSub.subscribe` + `takeUpTo` under `Effect.scoped`.
- **Errors**: operations against a closed or hostile client surface the domain error, never a bare `SqlError` (`Effect.flip` asserts the `_tag` and structured fields).

## Hardening

Not a parser; no untrusted-text recursion, no `MAX_NESTING_DEPTH`. What applies from the [input-hardening standards](../effect-standards.md#input-hardening-standards):

- **Numeric wiring guards** (`maxEntries`, migration `id`s, `toId`) reject `NaN` and non-integers explicitly.
- **SQL injection is structurally closed**: every value reaches SQLite through the tagged-template `SqlClient` (parameterized statements). The one hand-built string — the tag `LIKE` pattern — escapes `%`, `_`, `\` and is passed as a parameter with an `ESCAPE` clause.
- **Keys, tags and values are data, never SQL or paths**: a `__proto__` key is an ordinary TEXT primary key; tags round-trip through `JSON.stringify`/`parse`; the row-to-entry mapping builds `CacheEntry` via the schema constructor.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases. Gate: zero-warning `dist/prod/issues.json` via `pnpm build --filter @effected/store`, never the raw script.
