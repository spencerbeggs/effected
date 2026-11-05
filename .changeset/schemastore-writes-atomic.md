---
"@effected/schemastore": minor
---

## Features

* `SchemaFile` writes schema documents atomically through `@effected/files`, so a reader sees the old document or the new one, never a torn one (#1234, #1183). A failed write is still a `SchemaFileWriteError` naming the schema file, not the temp.

The directory holding a schema file needs write permission.

## Dependencies

| Dependency      | Type       | Action | From | To     |
| :-------------- | :--------- | :----- | :--- | :----- |
| @effected/files | dependency | added  | —    | ^0.1.0 |
