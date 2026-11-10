---
id: "0051"
title: "A driver SQL client (SqliteClient, PgClient, ...) is no longer assignable to SqlClient"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.3"
detect: ["(Sqlite|Pg|Mysql|Mssql|Libsql|D1)Client\\.(Sqlite|Pg|Mysql|Mssql|Libsql|D1)Client([^A-Za-z]|$)"]
---

This applies to code that uses a driver's own client service, such as `SqliteClient.SqliteClient` from `@effect/sql-sqlite-node` or `PgClient.PgClient`, where the generic `SqlClient` is expected. Driver clients now extend a new `SqlClient.Base` instead of `SqlClient` itself, so they no longer carry the generic type id (Effect-TS/effect#10387). Before, providing a generic `SqlClient` layer silently removed the driver requirement from an effect's type, and the program failed at runtime with `Service not found`.

- **A migration that reads the driver client no longer fits the migrator.** `SqliteMigrator.fromRecord` (and every `Migrator` loader) takes effects that require `SqlClient`. A record entry that does `yield* SqliteClient.SqliteClient` now fails to compile with "Property '[TypeId]' is missing in type 'SqliteClient'". Probed: it compiles on 4.1.2 and fails on 4.1.3. Yield `SqlClient.SqlClient` (from `effect/sql/SqlClient`) in the migration instead; the driver layer provides both services.
- **Passing a driver client where a `SqlClient` parameter is declared** fails the same way. Type the parameter as `SqlClient.Base` if it only needs the shared operations, or yield the generic service.
- A driver-specific service of your own should extend `SqlClient.Base`, not `SqlClient`, for the same reason.

Check the installed `effect/sql/SqlClient` `.d.ts` for `Base`. Verify with your typecheck, then run the migration tests against a real database file.
