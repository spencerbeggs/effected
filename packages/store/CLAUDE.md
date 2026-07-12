# @effected/store

Durable local state for Effect: two services over one primitive. `Store` is a schema-versioned, migrated `SqlClient` — a managed database connection with a user-defined migration ledger. `Cache` is a `key → Uint8Array` cache with TTL, tags, an eviction policy and a `CacheEvent` stream. Tenth migration, extracted from `xdg-effect`: the XDG concepts stayed behind for the future `@effected/xdg`, which will supply the database *path*.

The two are genuinely different services, not one with a flag: an evicted cache entry is correct behaviour, a lost state row is a bug. The shared primitive is the migration-ledger engine in `src/internal/migrator.ts` — `Store` exposes it with user-supplied migrations, `Cache` uses it privately to version its own fixed schema. The engine is parameterized by ledger **table name** (`_store_migrations` vs `_cache_migrations`), so a Store and a Cache can share one database file without id collisions.

**Design doc:** `@../../.claude/design/effected/packages/store.md` — load before changing the service shapes, the error model or the migration engine.

## Tier: integrated

**Integrated tier**, and the only package in the repo that is. `peerDependencies` is `effect` alone; `dependencies` is `@effect/sql-sqlite-node` (`catalog:effect`) — one regular runtime dependency, which is precisely what makes store tier 3. Its only peer is `effect`, which store already declares, so the peer closure is complete by construction.

Consumers of store are tier 3 by [R2](../../.claude/design/effected/effect-standards.md#dependency-policy). That is *why* the SQLite services were split out of `@effected/xdg` — so xdg stays boundary tier. Do not let store's dependency leak upward: no store type signature exposes a `SqliteClient` type, the driver appears only inside `layerSqlite`/`layerTest`, and it must stay that way.

## The v4 SQL facts (easy to get wrong)

- **The SQL core lives in `effect` itself**, under `effect/unstable/sql/*` — `SqlClient`, `Statement`, `SqlError`, transactions. There is **no `@effect/sql` package on the v4 line**; do not add one. Import `SqlClient` from `effect/unstable/sql/SqlClient`. The namespace is `unstable` upstream, so its surface can shift between betas — the whole repo pins one catalog, so drift is caught at catalog bumps.
- **`@effect/sql-sqlite-node` rides Node's built-in `node:sqlite`** — no native compile step, no `better-sqlite3`, no transitive peers. It ships on the same `4.0.0-beta` version train as `effect`.
- **`SqliteClient.layer` has no error channel.** Driver construction failures — chiefly a `filename` whose parent directory does not exist — are **defects**, not typed failures. That is why `Store.layerSqlite` and `Cache.layerSqlite` publish only the domain error in `E`. Ensuring the directory exists is the caller's job (and will be `@effected/xdg`'s).
- **`effect/unstable/sql/Migrator` is deliberately not used.** It is forward-only: no `down`, no rollback, no status projection. Store's contract carries all three, so `src/internal/migrator.ts` owns its own ledger.

## The layer trio

Both services expose the same three statics, and the split is load-bearing:

- `layer(options)` — driver-agnostic; requires an abstract `SqlClient` in `R`. Any Effect SQL driver satisfies it. This is the seam.
- `layerSqlite(options & { filename })` — batteries included, provides the sqlite driver itself.
- `layerTest(options)` — `layerSqlite` at `:memory:`. Hermetic; what the suites use.

The statics are **parameterized factories**, so calling one twice builds two layers: bind the result to a `const` and reuse it, or Layer memoization-by-reference is lost and the database is opened twice.

`Store.layer` construction ensures the ledger and runs all pending migrations, surfacing failures on the layer's **typed** error channel — the v3 `Effect.orDie` laundering is not ported.

A migration's `up`/`down` return `Effect<unknown, SqlError>`, **not `Effect<void, SqlError>`**. A `SqlClient` tagged template resolves to the statement's rows, so a `void` return forced every consumer to pipe an `Effect.asVoid` onto an otherwise self-describing ``sql`CREATE TABLE …` ``. The engine discards the value either way. Do not re-narrow it to `void`.

## Error model and what stays a defect

Three `Schema.TaggedErrorClass` types (`StoreError`, `StoreMigrationError`, `CacheError`), each carrying the underlying `SqlError` structurally in a `cause: Schema.Defect()` field. `SqlError` is **wrapped, never leaked**.

The line between failure and defect is the package's sharpest rule, and v3 got it wrong:

- **No defect laundering.** v3's `catchAllDefect → CacheError/StoreError` masked programmer errors as domain errors; it is not ported. A throwing `up`/`down` migration or a throwing `onRemoved` callback stays a **defect** (`withTransaction` still rolls back on it). Only typed `SqlError` becomes a domain error.
- **Wiring errors die at construction**: duplicate or non-positive-integer migration `id`s, a `maxEntries` that is not a positive integer, a non-integer or negative `rollback(toId)`. The guards are `Number.isInteger(n) && n >= 1` shaped, never a bare `< 1` — `NaN < 1` is `false`.

## Cache invariants

- **Transactional `onRemoved`**: the callback runs *inside* the delete transaction, a typed failure rolls the delete back and suppresses the event, and the caller's `E` survives in the signature (`CacheError | E`). This is the shape most worth not breaking.
- **Lazy expiry**: `get`/`has` delete an expired row on read; `prune` sweeps in bulk. Expiry reads the clock via `DateTime.now`, so `TestClock` drives it deterministically.
- **Eviction is least-recently-*written*, not LRU-read**: `INSERT OR REPLACE` re-mints the rowid, so ascending rowid is exactly write order. Deterministic and index-free — do not "improve" it into a read-touching LRU without a design change.
- **Tag matching escapes before it interpolates.** `invalidateByTag` matches the **JSON-encoded** tag against the `tags` column with `%`, `_` and `\` escaped and an `ESCAPE` clause. v3 matched the raw tag, so a tag containing a backslash or a quote never matched its own entries — that bug was found and fixed by this port's suite. Everything else reaches SQLite through the tagged-template `SqlClient`, so SQL injection is structurally closed.
- Keys, tags and values are **data, never SQL or paths**: a `__proto__` key is an ordinary TEXT primary key.

## Observability

Every public fallible method is a named span (`Store.migrate`, `Cache.get`, …), uniform per the house ceiling-and-floor rule. `store.client` is a value, not an operation — no span. No metrics, no logging in the hot path. The `SqlClient` layer beneath already annotates statement spans, so store spans nest over driver spans for free.

## Testing and building

Tests live in `__test__/Store.test.ts` and `__test__/Cache.test.ts`, use `@effect/vitest` with the top-level `layer(...)` fixture form (per-block where options differ), and assert with `assert.*` — never `expect`. `Cache` TTL and expiry are driven by `TestClock.adjust`; no real sleeps.

```bash
pnpm vitest run packages/store          # from the repo root
pnpm build --filter @effected/store     # from the repo root
```

`savvy.build.ts` carries the standard narrow `ae-forgotten-export` suppression for the synthesized `_base` symbols of the schema and service classes. Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
