---
type: Module
title: store
description: Durable local state for Effect v4 — a schema-versioned migrated SqlClient and a TTL key-value cache, sharing one migration-ledger engine over a single SQLite driver dependency.
status: stable
kind: package
resource: ../../packages/store
layer: L1
tags:
  - architecture
  - performance
sources:
  - id: store-package-json
    resource: ../../packages/store/package.json
  - id: store-claude-md
    resource: ../../packages/store/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 9a9450555b1fa1b4fa1f454ff6494fe214c2dfa07b7ab25c67317b3cbb1bdc84
---

# store

## Purpose and tier

`@effected/store` is durable local state for Effect applications: two
services over one shared primitive.

- **`Store`** — a schema-versioned, migrated `SqlClient`: a managed
  database connection with a user-defined migration ledger.
- **`Cache`** — a key → `Uint8Array` cache with TTL, tags, an eviction
  policy and a `CacheEvent` PubSub.

The two are genuinely different services, not one with a flag: an
evicted cache entry is correct behaviour; a lost state row is a bug. The
shared primitive is the migration-ledger engine in
`src/internal/migrator.ts` — `Store` exposes it with user-supplied
migrations, `Cache` uses it privately to version its own fixed schema.
The engine is parameterized by ledger **table name**, so a Store and a
Cache can share one database file without id collisions.

XDG concepts are out of scope: every layer takes a `filename` or an
abstract `SqlClient`, so [xdg](xdg.md) and [app](app.md) wire `AppDirs ->
filename` without store knowing about either.

**Integrated tier**, the only package in the kit that is — see
[the library-tier glossary entry](../glossary/library-tier.md). Its
`dependencies` is `@effect/sql-sqlite-node` alone, and that single
runtime dependency is what makes it tier 3 — see
[store is v4 SQLite](../decisions/store-v4-sqlite.md) for why that driver
and not another. `peerDependencies` is `effect` alone, so the peer
closure is complete by construction and store adds no
`@effected/*` edges. Consumers of store become tier 3 in turn (per
[the dependency policy](../conventions/dependency-policy.md)'s R2), which
is why the SQLite services were split out of [xdg](xdg.md) rather than
living beside XDG resolution — see
[xdg does not depend on store](../decisions/xdg-does-not-depend-on-store.md).
**The driver must never leak upward**: no store type signature exposes a
`SqliteClient` type, and the driver appears only inside the
`layerSqlite`/`layerTest` convenience layers.

## Module layout

`src/Store.ts`, `src/Cache.ts`, `src/Bytes.ts` (the `Uint8ArrayFromUtf8`
codec) and `src/internal/migrator.ts` (the shared ledger engine, defining
its own record types rather than importing from either facade — an
import cycle there would trip Biome's error-level `noImportCycles`
rule).[^store-claude-md]

## Public surface

### The layer trio

Both `Store` and `Cache` publish the same three statics:

- **`layer`** — driver-agnostic; requires an abstract `SqlClient` in `R`,
  so any v4 Effect SQL driver satisfies it.
- **`layerSqlite`** — provides the sqlite driver itself. It takes two
  options beyond `filename`: `client` (the remaining `SqliteClientConfig`
  passthrough, excluding `filename` and the two result-name-transform
  options — those would rewrite the ledger's internal query column names
  and silently make `status` report every migration pending), and
  `checkpointOnClose` (a best-effort `PRAGMA wal_checkpoint(TRUNCATE)`
  finalizer registered via a per-call internal layer that depends on the
  client layer, so it builds after the client and runs its finalizer
  before `db.close()`; it is a factory rather than a shared layer const
  because a shared const would checkpoint only the first of two open
  databases).
- **`layerTest`** — `layerSqlite` at `:memory:`, hermetic; what the
  suites use.

**The memoization trap.** These statics are parameterized factories, not
layer values: each call builds a new `Layer`, and Effect memoizes layers
by reference. Calling `Store.layerSqlite({...})` inline at two provide
sites opens the database **twice** — two connections onto one file, two
ledger setups, and for `Cache` two independent PubSubs whose subscribers
each see half the events. Bind the result to a `const` once and reuse
that binding; every package wiring a layer over a path inherits this
discipline (see [app](app.md#memoization) for
where it bites hardest).

Deliberately not done: no `mkdir: true` on `layerSqlite` — directory
creation is path policy, owned by the caller or [xdg](xdg.md). No
`Store.adoptLedger(fromTable)` API — adoption from core's own
`effect/sql/Migrator` ledger is a documented one-time SQL recipe
in the package README rather than an API, until a consumer's migrations
are not idempotent enough to run the recipe by hand.

### Store

Layer construction ensures the ledger table and runs all pending
migrations, surfacing construction failures on the layer's **typed**
error channel. `migrate` re-applies after a `rollback`; `status`
projects the full list with per-migration application time;
`rollback(toId)` rolls back applied migrations with a higher id in
descending order, invoking `down` where defined — a migration without
`down` is skipped over, its ledger row still removed. **A migration
without `down` therefore leaves its schema change in place while its
ledger row disappears**, so a later `migrate` re-runs its `up` against a
database that still has the table; give every migration a `down`, or
treat one without as a floor `rollback(toId)` may never cross.

A migration's `up`/`down` return `Effect<unknown, SqlError>`, not
`Effect<void, ...>` — a `SqlClient` tagged template resolves to the
statement's rows, so a `void` return type would force every consumer to
pipe an `Effect.asVoid` onto an otherwise self-describing statement. The
engine discards the value either way.

### Cache

- **The transactional `onRemoved` contract** — the callback runs inside
  the delete transaction; a typed failure rolls the delete back and
  suppresses the event, and the caller's `E` survives in the signature. A
  callback that throws propagates as a defect, never laundered into
  `CacheError`.
- **Lazy expiry** — `get`/`has` delete an expired row on read; `prune`
  sweeps in bulk. Expiry reads the clock via `DateTime.now`, so
  `TestClock` drives it deterministically.
- **Eviction is least-recently-written, not LRU-read.** `INSERT OR
  REPLACE` re-mints the rowid, so ascending rowid is exactly write order
  — deterministic and index-free.
- **`Cache.through` / `throughVerbose`** is a static reaching `Cache`
  from context rather than a member of the cache shape, so no test double
  needs an implementation for it. Two policies are load-bearing: a value
  that fails to decode, or is not valid UTF-8, is a **miss, not a
  failure** (those bytes were written by an older build of the caller's
  own program, and every cached value is re-derivable by definition), and
  `CacheError` is **surfaced, never swallowed** — a cache is additive, so
  swallowing is defensible, but it is the caller's call via `catchTag`.
- **`Uint8ArrayFromUtf8`** (`src/Bytes.ts`) exists because core's Schema
  ships `Uint8ArrayFromBase64`/`Base64Url`/`Hex` and nothing for UTF-8.
  Encoding fails on malformed UTF-8 rather than substituting `U+FFFD`,
  keeping a corrupt value distinguishable from a valid one containing
  that character.
- **`invalidateByTag` matches in the encoded domain.** Tags are stored as
  one JSON-encoded array in a TEXT column; the `LIKE` pattern is built
  from the JSON-encoded tag, with `LIKE` metacharacters escaped and an
  explicit `ESCAPE` clause, so a tag containing a backslash or quote
  still matches its own entry. The pattern still reaches SQLite as a
  parameter.
- **`Cache.degrading`** is an opt-in combinator over any `Cache` layer: a
  construction failure yields a working, empty cache instead of failing
  the layer, and `CacheShape.degraded` reads `true`. It catches
  **defects**, because `SqliteClient.layer` reports its most common
  construction failure — a missing parent directory — as a defect, not a
  typed failure, so a failure-only catch would miss exactly the case the
  combinator exists for. It deliberately does **not** catch interruption:
  a shutting-down fiber must not receive a working cache in its place.
  When a cause carries both a failure and an interruption, interruption
  wins and the failure half is dropped from what is re-raised — the
  posture is right but lossy, and the loss is invisible in the type. The
  degraded shape runs no `onRemoved` callbacks, since nothing ever
  entered it. It is opt-in, never the default, and it belongs at layer
  level rather than inside each service method: hoisting layer
  construction to build time is what would move the failure from a
  caught construction error to an uncaught runtime abort, and nothing
  behavioural about that change is visible to a reviewer.

### Events

The `CacheEvent` PubSub lives on the cache shape rather than a separate
opt-in service, created unbounded so a slow subscriber never
backpressures a write, with infallible emission. Events are a consumer
hook, not the package's own telemetry.

## Relationship to core persistence

Core's `effect/persistence/KeyValueStore` is the plain-KV subset
of this package's noun. It has no TTL, no tag invalidation, no eviction
policy, no event stream and no reversible migration ledger — the
value-add that justifies `Cache` and `Store`. A future surface here that
drops that value-add is a reinvention and should point the consumer at
`KeyValueStore` instead; request-level durable caching belongs on core's
`PersistedCache`/`Persistence`, not beside them.

## Errors

Three `Schema.TaggedError` types — `StoreError`, `StoreMigrationError` and
`CacheError` — each carrying the underlying failure structurally in a
`cause: Schema.Defect()` field; `StoreMigrationError` additionally
carries the migration's `direction`, `id` and `name`. `SqlError` is
wrapped, never leaked. No defect laundering: only typed failures map into
a domain error, and a throwing `onRemoved` or migration callback
propagates as a defect (`withTransaction` still rolls back on it).
Wiring errors are construction defects: duplicate or non-positive-integer
migration ids, a `maxEntries` that is not a positive integer, a
non-integer or negative rollback target, each guarded
`Number.isInteger(n) && n >= 1`-shaped rather than a bare `< 1`. A bad
`filename` is a wiring defect from the driver — the caller wiring the
path is responsible for ensuring the directory exists first.

## Observability

Every public fallible method is a named `Effect.fn` span. `store.client`
is a value, not an operation, so it carries no span. No metrics, no
hot-path logging — the package stays telemetry-agnostic. The `SqlClient`
layer beneath annotates statement spans, so store spans nest over driver
spans for free.

## Testing

Suites in `__test__/`, hermetic on `layerTest` (`:memory:`); TTL and
expiry are driven by `TestClock.adjust`, never real sleeps. Preserved
properties: migrations apply in id order regardless of supplied order; a
second construction over the same file applies nothing further; rollback
stops at its target and `migrate` re-applies afterward; a failing typed
`up` surfaces with the right identity and leaves prior migrations
applied, while a throwing `up` stays a defect; a failing `onRemoved`
rolls the delete back and suppresses the event; operations against a
hostile client surface the domain error, never a bare `SqlError`.
Rollback is additionally exercised against a real on-disk database by
the reposets consumer, not only the suite's hermetic `:memory:` coverage.

## Hardening

Not a parser; no untrusted-text recursion, no nesting-depth cap. Numeric
wiring guards reject `NaN` and non-integers explicitly. SQL injection is
structurally closed — every value reaches SQLite through the
tagged-template `SqlClient`, and the one hand-built string (the `LIKE`
pattern) is escaped and passed as a parameter with an `ESCAPE` clause.
Keys, tags and values are data, never SQL or paths — a `__proto__` key is
an ordinary TEXT primary key.

## Build

`savvy.build.ts` carries the standard narrow `{ messageId:
"ae-forgotten-export", pattern: "_base" }` suppression for the
synthesized bases of the schema and service classes. Gate on a
zero-warning `dist/prod/issues.json` via `pnpm build --filter
@effected/store`, never the raw `savvy.build.ts` script directly.

[^store-claude-md]: `packages/store/CLAUDE.md` — module layout, the
    layer trio, and the error/defect line.
