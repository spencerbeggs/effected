---
"@effected/store": minor
---

## Features

`Store.layerSqlite` and `Cache.layerSqlite` gain two options:

- `client` — an `Omit<SqliteClientConfig, "filename" | "transformResultNames" | "transformQueryNames">` passthrough to `SqliteClient.layer`, for tuning the underlying SQLite driver. `filename` stays owned by the layer, and the two name-transform options stay excluded — they would silently rewrite the migration ledger's own column names.
- `checkpointOnClose` — registers a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs before the driver closes the connection, folding the WAL into the main database file eagerly. Useful when another process may open the file right after this scope closes. The checkpoint is best-effort: a failure never turns a clean shutdown into a failed one.

```ts
const StoreLayer = Store.layerSqlite({
	filename: "state.db",
	migrations,
	client: { readonly: false },
	checkpointOnClose: true,
});
```
