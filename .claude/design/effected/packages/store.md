---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - config-file.md
---

# @effected/store design

## Overview

Design for `@effected/store`, the **tenth** package migration (step 2 of [migration-playbook.md](../migration-playbook.md)) and an **integrated-tier** package — the only one in the kit. Store is durable local state for Effect applications: two services over one primitive, extracted from `xdg-effect` (v2.1.0) per the [xdg review](../../../reviews/xdg.md) §5 seam 1 and the 2026-07-09 split decision in [package-inventory.md](../package-inventory.md).

Status: **merged** (playbook steps 2–6 complete). Per the semver/jsonc precedent this doc now records the *as-built* design, with deviations from the approved draft noted inline as "As-built:". The port broke the most new ground of any migration so far — it is the first package to take a runtime dependency, the first to touch SQL and the first to depend on the `effect/unstable/*` surface — so the two findings the next migration most needs are called out where it will look for them: the [`invalidateByTag` encoding bug](#cache) and the [layer-static memoization trap](#the-layer-trio).

- **`Store`** — a schema-versioned, migrated `SqlClient`: a managed database connection with a user-defined migration ledger (v3 `SqliteState`, renamed for what it is rather than how it is backed).
- **`Cache`** — a key → `Uint8Array` cache with TTL, tags, an eviction policy and a `CacheEvent` PubSub (v3 `SqliteCache`).

The two are genuinely different services, not one with a flag: an evicted cache entry is correct behaviour; a lost state row is a bug. The shared primitive is the migration-ledger engine in `src/internal/migrator.ts` — `Store` exposes it with user-supplied migrations; `Cache` uses it privately to version its own fixed schema.

The XDG concepts (`AppDirs`, resolvers, `nativeDirs`) are **out of scope** — they stay for the later `@effected/xdg` migration, which will supply the database *path*. Nothing here depends on xdg: every layer takes a `filename` (or an abstract `SqlClient`), so xdg/app-kit later wire `AppDirs → filename` without store knowing. The v3 `SqliteCacheXdgLive`/`SqliteStateXdgLive` layers are therefore not ported; they reappear as glue in `@effected/app-kit`.

## The v4 SQLite decision

The v3 code used `@effect/sql` + `@effect/sql-sqlite-node` from the v3 line, with a messy peer closure (`@effect/experimental` undeclared, cluster/rpc leakage — review §6). The v4 beta dissolves the whole problem:

- The SQL **core** (`SqlClient`, `Statement`, `SqlError`, transactions) moved into `effect` itself under `effect/unstable/sql/*` — no `@effect/sql` package exists on the v4 line.
- `@effect/sql-sqlite-node@4.0.0-beta.94` is published on the same version train as `effect`, peers on **`effect` alone**, and is implemented over Node's built-in `node:sqlite` — no native compile step, no `better-sqlite3`, no transitive peers.

So the "is there a viable v4 path" question answers itself: **use `SqlClient` from `effect/unstable/sql` as the abstract seam and `@effect/sql-sqlite-node` as the concrete driver.** Both are already pinned in the `effect` catalogs. Hand-rolling a `node:sqlite` service was considered and rejected: `@effect/sql-sqlite-node` *is* the thin Effect service over `node:sqlite` (statement serialization, prepared-statement cache, WAL, tracing attributes), and re-implementing it would duplicate upstream code to save a dependency that costs nothing transitively.

One risk is accepted and recorded: `effect/unstable/sql` is an **unstable** namespace upstream, so its surface may shift between betas. The whole repo pins one catalog version and nothing publishes before `0.1.0`, so drift is caught at catalog bumps, not by consumers.

As-built: the decision held with one fact worth carrying forward — **`SqliteClient.layer` has no error channel**. Driver construction failures, chiefly a `filename` whose parent directory does not exist, arrive as **defects**, not typed failures, which is why `layerSqlite`/`layerTest` publish only the domain error in `E` (see [Error handling](#error-handling)). A package wiring a database path is therefore responsible for ensuring the directory exists *before* the layer is built; nothing downstream can catch it typed.

`effect/unstable/sql/Migrator` (core's own migrator) was evaluated and **not** used: it is forward-only — no `down` migrations, no rollback, no status projection — and Store's contract carries all three. The internal engine is ~100 lines and owns its ledger table shape.

## Tier and dependencies

**Integrated tier**, by decision recorded here per [R1](../effect-standards.md#dependency-policy): the runtime dependency on `@effect/sql-sqlite-node` is what makes the package tier 3, exactly as the inventory row anticipated. Consumers of store are tier 3 by [R2](../effect-standards.md#dependency-policy) — which is why the sqlite services were split *out* of `@effected/xdg` in the first place, keeping xdg boundary tier.

- `peerDependencies`: `effect` (`catalog:effect`).
- `dependencies`: `@effect/sql-sqlite-node` (`catalog:effect`) — a regular dependency, following the `@effected/package-json`/`spdx-expression-parse` precedent. Its only peer is `effect`, which store already declares, so the peer closure is complete by construction. No store type signature exposes a `SqliteClient` type; the driver appears only inside the `layerSqlite`/`layerTest` convenience layers, so a consumer never needs to import it.
- No `@effected/*` edges, so no `prepare` script.

The core layers (`Store.layer`, `Cache.layer`) require an abstract `SqlClient` — the v3 posture the review praised, kept verbatim. Any v4 driver satisfies them; the sqlite dependency funds the batteries-included layers.

## Module layout

Module-per-concept, two concept files:

```text
packages/store/
  src/
    Store.ts        # StoreMigration, StoreMigrationResult, StoreMigrationStatus,
                    # StoreError, StoreMigrationError, Store service + layer/layerSqlite/layerTest
    Cache.ts        # CacheEntry, CacheEntryMeta, CacheRemovalResult, CacheEvent(+Payload),
                    # CacheError, Cache service + layer/layerSqlite/layerTest
    index.ts        # public surface, re-exports only
    internal/
      migrator.ts   # the shared primitive: ledger engine over SqlClient (ensure table,
                    # run pending, rollback, status) — raw records, no facade imports
  __test__/
    Store.test.ts
    Cache.test.ts
```

`internal/migrator.ts` is parameterized by ledger **table name**: `Store` uses `_store_migrations`, `Cache` uses `_cache_migrations` (with its built-in migration list, v1 = create `cache_entries` + expiry index). Two ledgers means a Store and a Cache can share one database file without id collisions, and the cache schema is itself versioned — "a Store with a fixed schema" made literal. The engine defines its own record types and imports nothing from the facades (`noImportCycles` is error-level).

## Public surface

### Store

```ts
interface StoreMigration {
  readonly id: number;      // positive integer, unique across the list
  readonly name: string;
  readonly up: (sql: SqlClient.SqlClient) => Effect.Effect<void, SqlError>;
  readonly down?: (sql: SqlClient.SqlClient) => Effect.Effect<void, SqlError>;
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

Layer construction ensures the ledger table and **runs all pending migrations** (v3 semantics), but the v3 `Effect.orDie` laundering is gone: construction failures surface on the layer's typed error channel. `migrate` re-applies after a `rollback`; `status` projects the full list with per-migration `appliedAt`. `rollback(toId)` rolls back applied migrations with `id > toId` in descending order, invoking `down` where defined (a migration without `down` is skipped over, ledger row still removed — v3 behaviour, now documented).

The v3 `up: Effect<void, unknown>` + `orDie` + `catchAllDefect` round-trip (review §2) is replaced by an honest channel: migrations do SQL, so their error is `SqlError`, wrapped by the engine into `StoreMigrationError`. A migration callback that **throws** is a programmer bug and stays a defect, per the [hardening callback rule](../effect-standards.md#error-handling-standards).

### The layer trio

Both services publish the same three statics, and the split is the seam: `layer` is driver-agnostic (it requires an abstract `SqlClient` in `R`, so any Effect SQL driver satisfies it), `layerSqlite` provides the sqlite driver itself and `layerTest` is `layerSqlite` at `:memory:`. Only the two `*Sqlite` layers name the driver, which is what keeps `@effect/sql-sqlite-node` out of every store type signature.

**As-built — the memoization trap.** The statics are *parameterized factories*, not layer values: each call builds a new `Layer`, and Effect memoizes layers **by reference**. Calling `Store.layerSqlite({...})` inline at two provide sites therefore opens the database **twice** — two connections onto one file, two ledger setups, and (for `Cache`) two independent PubSubs whose subscribers each see half the events. Bind the result to a `const` once and reuse that binding. This is not specific to store, but store is the first package in the kit where the cost of getting it wrong is a duplicated *resource* rather than a duplicated computation, so it is recorded here for the packages that follow (`xdg`, `app-kit`, `ts-vfs` all wire layers over a path).

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
  Schema.TaggedStruct("Evicted", { count, keys }),          // new: maxEntries eviction
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

Changes from v3, each deliberate:

- **`PruneResult` alias dropped** — it was a backwards-compat alias of `CacheRemovalResult`; there is no compat to keep.
- **`CacheEntryMeta` carries `DateTime.Utc` fields**, not the raw ISO strings v3 leaked from row shapes.
- **The transactional `onRemoved` contract is kept verbatim** (the review's headline praise): the callback runs inside the delete transaction, a typed failure rolls the delete back and suppresses the event, and the caller's `E` survives in the signature (`CacheError | E`). What changes: a callback that *throws* is no longer laundered into `CacheError` — see [Error handling](#error-handling).
- **Lazy expiry is kept**: `get`/`has` delete an expired row on read (`Expired` then `Miss` events); `prune` sweeps in bulk. Expiry reads the clock via `DateTime.now`, so `TestClock` drives it deterministically.
- **Eviction policy is new surface** (the inventory scope names it): with `maxEntries` set, `set` evicts the oldest-*written* entries (lowest `rowid` — `INSERT OR REPLACE` re-mints the rowid, so rowid order is write order) until the count is back at the bound, emitting one `Evicted` event. Least-recently-**set**, not LRU-read: deterministic, index-free and honest about what it is. A byte-budget policy (`maxSizeBytes`) is deferred until a consumer asks.

**As-built — the `invalidateByTag` encoding bug (inherited from v3, fixed here).** Tags are stored as one `JSON.stringify`'d array in a TEXT column, and v3 matched a tag by `LIKE`-ing the **raw** tag against that column. The column holds *encoded* text, so any tag whose JSON encoding differs from itself — one containing a backslash or a double quote — could never match its own entry: the cache silently kept entries the caller had asked it to drop. The port builds the pattern from the **JSON-encoded** tag instead, escapes the `LIKE` metacharacters (`%`, `_`, `\`) in it and passes an explicit `ESCAPE` clause, with a hostile-tag test pinning it. The escaped pattern still reaches SQLite as a *parameter*, so nothing is hand-concatenated into SQL.

The general lesson, for any package that stores structured data in a text column: **compare in the encoded domain, or decode before comparing — never mix the two.** A predicate written against the decoded value but evaluated against the encoded column is wrong for exactly the inputs a test suite built from friendly fixtures will not contain. This is the same class of defect as a path predicate that forgets separators are escaped.

### Events

`events` stays on the cache shape (v3 posture) rather than a separate opt-in service (`ConfigEvents` posture): cache events are intrinsic per-instance observability for an eviction-bearing store, and the PubSub is created with the service, unbounded so a slow subscriber never backpressures a cache write. `emit` is infallible (`DateTime.now` + `PubSub.publish`), so v3's swallow-own-failures wrapper has nothing left to swallow. Events are a consumer hook, not the package's telemetry — spans are (see [Observability](#observability)).

## Error handling

Three `Schema.TaggedErrorClass` types, replacing the v3 `reason: string` pattern (the review's "stringly-typed payloads destroy cause structure") with a structural `cause: Schema.Defect()`:

| Error | Fields | Raised by | Audience |
| --- | --- | --- | --- |
| `StoreError` | `operation` (`Literals(["setup", "migrate", "rollback", "status"])`), `cause` | ledger/SQL failures in Store ops | calling code (`_tag` + `operation` branching), operator (via span + `message`) |
| `StoreMigrationError` | `direction` (`Literals(["up", "down"])`), `id`, `name`, `cause` | a user migration failing | calling code — `id`/`name`/`direction` are exactly what a caller needs to report or repair |
| `CacheError` | `operation` (literal union of the nine cache ops), `key` (`optionalKey`), `cause` | SQL failures in Cache ops | calling code, operator |

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`SqlError` is wrapped, never leaked** — the underlying error lands structurally in `cause`, and each class derives a human `message` from its typed fields.
- **No defect laundering.** v3's `catchAllDefect → CacheError/StoreError` masked programmer errors as domain errors; it is not ported. Only typed failures (`SqlError`) are mapped into the domain error; defects — including a throwing `onRemoved` or migration callback — propagate as defects (`withTransaction` still rolls back on them).
- **Wiring errors are construction defects**, not typed failures: duplicate or non-positive-integer migration `id`s, and a `maxEntries` that is not a positive integer, die at layer construction with a message naming the bad value. The [NaN guard](../effect-standards.md#input-hardening-standards) applies: the check is `Number.isInteger(n) && n >= 1`, never a bare `< 1`. Likewise `rollback(toId)` dies on a non-integer or negative `toId` — it can only come from code.
- A bad `filename` (missing parent directory) is a wiring defect from the driver. The future `@effected/xdg` supplies paths whose directories it has ensured; that is its job, not store's.

## Observability

Every public fallible method is a named `Effect.fn` span, uniform per the house ceiling-and-floor rule: `Store.migrate`, `Store.rollback`, `Store.status`, `Cache.get`, `Cache.set`, `Cache.has`, `Cache.entries`, `Cache.invalidate`, `Cache.invalidateByTag`, `Cache.invalidateAll`, `Cache.prune`. `store.client` is a value, not an operation — no span. No metrics (the app meters its calls); no logging in the hot path; telemetry-agnostic throughout. The `SqlClient` layer beneath already annotates statement spans with `db.system.name`, so store spans nest over driver spans for free.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suites in `__test__/Store.test.ts` and `__test__/Cache.test.ts`. The v3 suites (plain `it` + `Effect.runPromise` + `expect` + real `sleep`) are rewritten, not ported. `layerTest` (`:memory:`) provides hermetic databases; groups provision via top-level `layer(...)` where the fixture allows, with per-fixture blocks where options differ (the walker house shape).

Required coverage, including the mutation-prone edges:

- **Store**: fresh-db construction applies all migrations in `id` order (ids supplied out of order — the sort is observable); a second construction over the same file applies nothing; `rollback(toId)` runs `down` in descending order and stops *at* `toId` (a boundary test with the target beyond one migration, so the bound must act); `migrate` re-applies after rollback; `status` distinguishes applied/pending; a failing `up` surfaces `StoreMigrationError` with the right `id`/`direction` and leaves prior migrations applied; a *throwing* `up` stays a defect (the no-laundering assertion, via `Effect.exit` + `Cause.isDieReason`).
- **Cache**: set/get round-trip incl. BLOB fidelity and tags; miss on absent key; TTL expiry driven by `TestClock.adjust` (entry live before, expired after — both observed); `prune` removes only expired rows; `defaultTtl` applies when `set` omits `ttl`, and `ttl` overrides it; `maxEntries` eviction evicts the oldest-written keys and emits `Evicted` (a test with the bound at 2 and three writes, asserting *which* key died); `invalidate` skips `onRemoved` when the key is absent; a failing `onRemoved` rolls back the delete (entry still present) and suppresses the event; the caller's `E` survives the channel; a throwing `onRemoved` is a defect; event stream ordering for set/hit/miss via `PubSub.subscribe` + `takeUpTo` under `Effect.scoped` (the clock-free drain).
- **Errors**: cache/store operations against a closed or hostile client surface the domain error, never a bare `SqlError` — `Effect.flip` asserts the `_tag` and structured fields.

## Hardening

Not a parser; no untrusted-text recursion surfaces, no `MAX_NESTING_DEPTH`. What applies from the [input-hardening standards](../effect-standards.md#input-hardening-standards):

- **Numeric wiring guards** (`maxEntries`, migration `id`s, `toId`) reject `NaN` and non-integers explicitly — see [Error handling](#error-handling).
- **SQL injection is structurally closed**: every value reaches SQLite through the tagged-template `SqlClient` (parameterized statements). The one string built by hand — the tag `LIKE` pattern — escapes `%`, `_` and `\` and is passed *as a parameter* with an `ESCAPE` clause, with a hostile-tag test. As-built correction: v3 escaped the metacharacters but built the pattern from the **raw** tag rather than the JSON-encoded one, which is the [encoding bug](#cache) this port fixed. Injection was never the hole; correctness was.
- **Keys, tags and values are data, never SQL or paths**: a `__proto__` key is an ordinary TEXT primary key; tags round-trip through `JSON.stringify`/`parse` into a plain array, and the row-to-entry mapping builds `CacheEntry` via the schema constructor, not bare object assembly.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases (`CacheEntry`, `CacheEvent`, `StoreMigrationStatus`, the three error classes, the two `Context.Service` classes). Gate: zero-warning `dist/prod/issues.json` via `pnpm build --filter @effected/store`, never the raw script.
