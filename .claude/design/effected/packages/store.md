---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../consumers/reposets.md
  - config-file.md
  - app.md
  - xdg.md
---

# @effected/store design

## Overview

`@effected/store` is durable local state for Effect applications: two services over one primitive.

- **`Store`** — a schema-versioned, migrated `SqlClient`: a managed database connection with a user-defined migration ledger.
- **`Cache`** — a key → `Uint8Array` cache with TTL, tags, an eviction policy and a `CacheEvent` PubSub.

The two are genuinely different services, not one with a flag: an evicted cache entry is correct behaviour; a lost state row is a bug. The shared primitive is the migration-ledger engine in `src/internal/migrator.ts` — `Store` exposes it with user-supplied migrations; `Cache` uses it privately to version its own fixed schema. The engine is parameterized by ledger **table name**, so a Store and a Cache can share one database file without id collisions, and the cache schema is itself versioned. It defines its own record types and imports nothing from the facades (`noImportCycles` is error-level).

XDG concepts are **out of scope** and supply the database *path* from elsewhere: every layer takes a `filename` or an abstract `SqlClient`, so [@effected/xdg](xdg.md) and [@effected/app](app.md) wire `AppDirs → filename` without store knowing.

## The v4 SQLite decision

The abstract seam is `SqlClient` from `effect/unstable/sql`; the concrete driver is `@effect/sql-sqlite-node`. The SQL core — `SqlClient`, `Statement`, `SqlError`, transactions — lives in `effect` itself under `effect/unstable/sql/*`; **there is no `@effect/sql` package on the v4 line**, so do not add one. The driver is published on the same version train as `effect`, peers on `effect` alone, and is implemented over Node's built-in `node:sqlite` — no native compile step, no `better-sqlite3`, no transitive peers.

Two facts are load-bearing:

- **`effect/unstable/sql` is an unstable namespace upstream.** The whole repo pins one catalog version, so surface drift is caught at catalog bumps rather than by consumers.
- **`SqliteClient.layer` has no error channel.** Driver construction failures — chiefly a `filename` whose parent directory does not exist — arrive as **defects**, not typed failures, which is why `layerSqlite`/`layerTest` publish only the domain error in `E`. A package wiring a database path must ensure the directory exists *before* the layer is built; nothing downstream can catch it typed. [@effected/app](app.md#appstore-and-appcache--the-database-glue) is where that ensure-before-open ordering lives.

Core's own `effect/unstable/sql/Migrator` is **not** used: it is forward-only — no `down`, no rollback, no status projection — and Store's contract carries all three.

## Tier and dependencies

**Integrated tier** by [R1](../effect-standards.md#dependency-policy): the runtime dependency on `@effect/sql-sqlite-node` is what makes it tier 3, and consumers become tier 3 by [R2](../effect-standards.md#dependency-policy). That propagation is *why* the sqlite services were split out of [@effected/xdg](xdg.md), which stays boundary tier as a result.

`peerDependencies` is `effect` alone; `dependencies` is the sqlite driver and nothing else. Its only peer is `effect`, which store already declares, so the peer closure is complete by construction. No `@effected/*` edges, so no `prepare` script.

**Do not let the driver leak upward.** No store type signature exposes a `SqliteClient` type — the driver appears only inside the `layerSqlite`/`layerTest` convenience layers, and it must stay that way.

## Public surface

The exact shapes are in `src/Store.ts` and `src/Cache.ts`. What matters here:

### The layer trio

Both services publish the same three statics, and the split is the seam:

- **`layer`** is driver-agnostic — it requires an abstract `SqlClient` in `R`, so any v4 Effect SQL driver satisfies it.
- **`layerSqlite`** provides the sqlite driver itself.
- **`layerTest`** is `layerSqlite` at `:memory:`.

Only the two `*Sqlite` layers name the driver. The sqlite dependency funds the batteries-included layers only.

**Sqlite layer options.** Both `layerSqlite` statics take two options beyond `filename`, and the rulings behind them are deliberate:

- **`client?: Omit<SqliteClientConfig, "filename" | "transformResultNames" | "transformQueryNames">`** — the remaining driver options passed through to `SqliteClient.layer`. `filename` stays owned by the layer (spread first, `filename` last, and the `Omit` closes it at the type level). The two name-transform options are **excluded on purpose**: they rewrite the result names of the internal ledger queries (`applied_at` → `appliedAt`), silently making `status` report every migration pending — and every Cache query reads snake_case columns. Core's own Migrator shields its ledger SQL with `.withoutTransform`; adopting that hardening engine-wide is the price of ever admitting them. Referencing the driver's *config type* here does not breach the "no store type signature exposes a `SqliteClient` type" rule — that rule guards the service/driver type on the abstract seam, and `layerSqlite` is the sanctioned driver-naming surface; restating the fields locally would drift at every driver bump.
- **`checkpointOnClose?: boolean`** — registers a best-effort `PRAGMA wal_checkpoint(TRUNCATE)` finalizer (`Effect.ignore`, matching the shape every durable-SQLite consumer hand-wrote). It lives on the **sqlite layers only**: the PRAGMA is SQLite-specific, and putting it on the driver-agnostic `layer` would break the seam. Mechanism: a per-call internal layer (`src/internal/sqlite.ts`) that *depends on* the client layer, so it builds after the client and its finalizer runs before the driver's `db.close()` — reverse-registration order, pinned by a WAL-truncation test that defeats SQLite's checkpoint-on-last-close with a second open connection. The helper is a factory, never a shared layer const: layers memoize by reference, and one shared checkpoint layer under a Store and a Cache on two files would checkpoint only the first.

**Deliberately not done:** no `mkdir: true` on `layerSqlite` — directory creation is path policy, owned by the caller/[@effected/xdg](xdg.md) per the ensure-before-open rule above. No `Store.adoptLedger(fromTable)` API — adoption from `effect/unstable/sql/Migrator`'s `effect_sql_migrations` ledger is a documented one-time SQL recipe in the package README ("Adopting a database migrated by effect's Migrator"); an API waits for a consumer whose migrations are not idempotent and who cannot run the recipe.

**The memoization trap.** These statics are *parameterized factories*, not layer values: each call builds a new `Layer`, and Effect memoizes layers **by reference**. Calling `Store.layerSqlite({…})` inline at two provide sites opens the database **twice** — two connections onto one file, two ledger setups, and for `Cache` two independent PubSubs whose subscribers each see half the events. Bind the result to a `const` once and reuse that binding. Every package wiring a layer over a path inherits this discipline.

### Store

Layer construction ensures the ledger table and **runs all pending migrations**, surfacing construction failures on the layer's typed error channel. `migrate` re-applies after a `rollback`; `status` projects the full list with per-migration application time; `rollback(toId)` rolls back applied migrations with a higher id in descending order, invoking `down` where defined — a migration without `down` is skipped over, its ledger row still removed.

**Rollback is confirmed against a consumer's real on-disk database**, not only the suite's hermetic `:memory:` coverage: `rollback(1)` → `migrate` → `rollback(0)` → `migrate` over two real migrations, with `down` functions genuinely dropping tables rather than only clearing ledger rows, newest-first ordering as documented, and a clean re-`migrate` from both the partially and the fully unwound state ([reposets](../consumers/reposets.md)). No defect.

The trap that consumer avoided is the one to warn the next one about: **a migration without `down` leaves its schema change in place while its ledger row is removed**, so a later `migrate` re-runs its `up` against a database that still has the table. Either give every migration a `down`, or treat one without as a floor `rollback(toId)` may never go below.

A migration's `up`/`down` return `Effect<unknown, SqlError>`, **not `Effect<void, …>`**. A `SqlClient` tagged template resolves to the statement's *rows*, so a `void` return type would force every consumer to pipe an `Effect.asVoid` onto an otherwise self-describing ``sql`CREATE TABLE …` ``. The engine discards the value either way, so the wider return type lets a migration be the statement itself. Do not re-narrow it.

### Cache

The behavioural contract, which is where the design decisions live:

- **The transactional `onRemoved` contract**: the callback runs inside the delete transaction, a typed failure rolls the delete back and suppresses the event, and the caller's `E` survives in the signature. A callback that *throws* propagates as a defect, never laundered into `CacheError`. This is the shape most worth not breaking.
- **Lazy expiry**: `get`/`has` delete an expired row on read; `prune` sweeps in bulk. Expiry reads the clock via `DateTime.now`, so `TestClock` drives it deterministically.
- **Eviction is least-recently-*written*, not LRU-read.** With `maxEntries` set, `set` evicts the oldest-written entries until the count is back at the bound, emitting one event. `INSERT OR REPLACE` re-mints the rowid, so ascending rowid is exactly write order — deterministic and index-free. Do not "improve" it into a read-touching LRU without a design change. A byte-budget policy is deferred until a consumer asks.
- **Entry metadata carries `DateTime.Utc` fields**, not raw ISO strings, and listing entries never loads the BLOB values.

**Read-through (`Cache.through` / `throughVerbose`).** A static on the class rather than a member of `CacheShape`: it reaches `Cache` from context, so it needs no implementation in any test double and nothing implementing the shape has to change. It exists because `get → decode → miss → fetch → encode → set` is *the* reason to hold a cache, and the first consumer hand-wrote it three times ([reposets](../consumers/reposets.md)). Two policies moved from each consumer's judgement into the package, and both are load-bearing:

- **A value that fails to decode — or is not valid UTF-8 — is a miss, not a failure.** Those bytes were written by an older build of the caller's own program. The user did not cause it, cannot fix it without knowing the cache exists, and every cached value is re-derivable by definition, so failing would strand them behind a cache they cannot see. The stale entry is overwritten by the fresh one on the way out. The first consumer reached this policy independently and asked us to own it; owning it is what stops the next consumer reaching a *different* one.
- **`CacheError` is surfaced, never swallowed.** A cache is additive, so swallowing is defensible — but it is the *caller's* call, made with `catchTag`, because an unreadable database is a real and reportable condition. The package having no opinion here was itself the defect: the first consumer had to invent one.

**`Uint8ArrayFromUtf8` (`src/Bytes.ts`).** Core's Schema has `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and `Uint8ArrayFromHex` and **nothing for UTF-8**, which made this package's own documented advice — values are bytes, so encode through a schema — impossible to follow to the end: `fromJsonString` reaches `string` and stops. Consumers hand-wired a `TextEncoder` at precisely the seam the advice exists to close, or paid base64's 33% premium to stay inside Schema. Encoding fails on malformed UTF-8 rather than substituting `U+FFFD`, which is what keeps a corrupt value distinguishable from a valid one containing that character. It sits next to the byte-valued API that needs it rather than in a schema package; if core ships an equivalent, prefer core's.

**The `invalidateByTag` encoding rule.** Tags are stored as one JSON-encoded array in a TEXT column. Matching a tag builds the `LIKE` pattern from the **JSON-encoded** tag, not the raw tag, escapes the `LIKE` metacharacters and passes an explicit `ESCAPE` clause. A pattern built from the raw tag can never match its own entry when the tag contains a backslash or a double quote. The escaped pattern still reaches SQLite as a *parameter*, so nothing is hand-concatenated into SQL. The general lesson for any package storing structured data in a text column: **compare in the encoded domain, or decode before comparing — never mix the two.**

### Events

The event PubSub stays on the cache shape rather than a separate opt-in service: cache events are intrinsic per-instance observability for an eviction-bearing store. It is created with the service and unbounded, so a slow subscriber never backpressures a cache write, and emission is infallible. Events are a **consumer hook, not the package's telemetry** — spans are that.

## Relationship to core persistence

Core's `effect/unstable/persistence/KeyValueStore` is the plain-KV subset of this package's noun. The overlap is partial: it has no TTL, no tag invalidation, no eviction policy, no event stream and no reversible migration ledger — the value-add that justifies `Cache` and `Store`. Two binding consequences: any future surface here that drops that value-add is a reinvention, so point the consumer at core's `KeyValueStore` instead; and if this package ever grows request-level durable caching, core's `PersistedCache`/`Persistence` own that shape — build on them, not beside them.

## Error handling

Three `Schema.TaggedError` types — `StoreError`, `StoreMigrationError` and `CacheError` — each carrying the underlying failure structurally in a `cause: Schema.Defect()` field. `StoreMigrationError` additionally carries the migration's `direction`, `id` and `name`, which is what a caller needs to report or repair. See `src/Store.ts` and `src/Cache.ts` for the field lists.

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`SqlError` is wrapped, never leaked** — it lands structurally in `cause`, and each class derives a human `message` from its typed fields.
- **No defect laundering.** Only typed failures are mapped into a domain error; defects — including a throwing `onRemoved` or migration callback — propagate as defects, and `withTransaction` still rolls back on them.
- **Wiring errors are construction defects**: duplicate or non-positive-integer migration ids, a `maxEntries` that is not a positive integer, a non-integer or negative rollback target. The [NaN guard](../effect-standards.md#input-hardening-standards) applies — the check is `Number.isInteger(n) && n >= 1` shaped, never a bare `< 1`.
- A bad `filename` is a wiring defect from the driver; the caller wiring the path ensures the directory exists.

## Observability

Every public fallible method is a named `Effect.fn` span, uniform per the [ceiling-and-floor rule](../effect-standards.md#observability-standards). `store.client` is a value, not an operation — no span. No metrics, no hot-path logging; the package stays telemetry-agnostic. The `SqlClient` layer beneath annotates statement spans, so store spans nest over driver spans for free.

## Testing

Suites in `__test__/`, hermetic on `layerTest` (`:memory:`); TTL and expiry are driven by `TestClock.adjust`, never real sleeps. The properties worth preserving if the suites are rewritten: migrations apply in id order with ids supplied out of order (the sort is observable); a second construction over the same file applies nothing; rollback stops *at* its target and `migrate` re-applies afterwards; a failing `up` surfaces the typed error with the right identity and leaves prior migrations applied, while a *throwing* `up` stays a defect; a failing `onRemoved` rolls the delete back and suppresses the event; and operations against a hostile client surface the domain error, never a bare `SqlError`.

## Hardening

Not a parser; no untrusted-text recursion, no nesting-depth cap. What applies from the [input-hardening standards](../effect-standards.md#input-hardening-standards):

- **Numeric wiring guards** reject `NaN` and non-integers explicitly.
- **SQL injection is structurally closed**: every value reaches SQLite through the tagged-template `SqlClient`. The one hand-built string — the tag `LIKE` pattern — is escaped and passed as a parameter with an `ESCAPE` clause.
- **Keys, tags and values are data, never SQL or paths**: a `__proto__` key is an ordinary TEXT primary key, and the row-to-entry mapping builds the entry through the schema constructor.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases. Gate: zero-warning `dist/prod/issues.json` via `pnpm build --filter @effected/store`, never the raw script.
