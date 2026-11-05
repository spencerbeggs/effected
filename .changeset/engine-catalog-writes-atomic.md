---
"@effected/engine": minor
---

## Features

* `effected schema build` writes schema documents and catalog files atomically (#1234, #1183). A reader sees the old file or the new one, though a build still writes several files in turn.
* `syncFile` now fails with `SchemaFileWriteError` naming the slice the user asked for, rather than a bare platform error naming a temp.

The output directories need write permission.

## Dependencies

| Dependency      | Type       | Action | From | To     |
| :-------------- | :--------- | :----- | :--- | :----- |
| @effected/files | dependency | added  | —    | ^0.1.0 |
