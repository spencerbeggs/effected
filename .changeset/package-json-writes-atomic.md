---
"@effected/package-json": minor
---

## Features

* `PackageJsonFile` writes are atomic through `@effected/files`: a crash leaves the old file or the new one, never a truncated `package.json` (#1234, #1183).

Behaviour a consumer can trip on: the file's directory needs write permission, a read-only target is refused, the file's inode is replaced, and a symlinked target keeps its link and an existing file keeps its mode.

## Dependencies

| Dependency      | Type       | Action | From | To     |
| :-------------- | :--------- | :----- | :--- | :----- |
| @effected/files | dependency | added  | —    | ^0.1.0 |
