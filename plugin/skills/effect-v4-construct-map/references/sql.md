# SQL — v3 → v4

**`@effect/sql` as a standalone package is gone.** The SQL core moved into `effect`
itself, under `effect/unstable/sql/*` — `SqlClient`, `SqlError`, `Statement`,
`SqlSchema`, `SqlResolver`, `SqlModel`, `SqlStream`, `Migrator`. There is no
`@effect/sql` to install; it does not resolve from a v4 package.

| v3 | v4 |
| --- | --- |
| `import { SqlClient } from "@effect/sql"` | `import { SqlClient } from "effect/unstable/sql"` |
| `@effect/sql` + a driver package + `@effect/platform` peer chain | the **driver alone**, peering on `effect` and nothing else |
| `@effect/sql-sqlite-node` over `better-sqlite3` | over Node's built-in **`node:sqlite`** (`DatabaseSync`) — no native module to compile |

Only the *driver* is a dependency: `@effect/sql-sqlite-node@4.0.0-beta.97` declares
`peerDependencies: { effect: "^4.0.0-beta.97" }` and **no `dependencies` at all**. The
v3 habit of also installing `@effect/sql` and `@effect/platform` is now wrong. Four
behaviours worth knowing before you design against it:

- **`SqliteClient.layer` has NO error channel** — it is
  `Layer.Layer<SqliteClient | SqlClient.SqlClient>` (`SqliteClient.ts:347`). A
  construction failure (unopenable file, bad options) surfaces as a **defect**, not a
  typed error, so do not write a `catchTag` for it. The config-driven sibling
  `layerConfig` *does* carry `Config.ConfigError` (`:327`) — that is the one to reach
  for when the connection is configured from the environment.
- **`sql(name)` interpolates an identifier.** The template form
  ``sql`SELECT …` `` builds a `Statement`; calling the same `sql` with a plain string
  returns an `Identifier` (`Statement.ts` `Constructor`, `(value: string): Identifier`),
  so `` sql`SELECT * FROM ${sql(table)}` `` parameterizes the *table name* safely.
  `sql.unsafe` and `sql.literal` are the un-escaped escape hatches.
- **`sql.withTransaction` rolls back on DEFECTS and INTERRUPTS, not just typed
  failures.** It takes the `Exit` of the body and commits **only** on
  `Exit.isSuccess` (`SqlClient.ts:222` `makeWithTransaction`) — every other exit rolls
  back. Probed live on `effect@4.0.0-beta.97` against a `:memory:` database, with a
  positive control proving the probe can observe a commit: typed failure, `Effect.die`
  and `Effect.interrupt` each rolled back. A defect will not leave a half-written
  transaction committed — but neither is it a way to *keep* partial work.
- **`Migrator` is forward-only.** `effect/unstable/sql/Migrator` exists, with loaders
  (`fromFileSystem`, `fromGlob`, `fromRecord`, `fromBabelGlob`), but there is **no down
  migration, no rollback and no status command** — the words do not appear in the
  module. Migrations are append-only; to undo one you write a new forward migration.
