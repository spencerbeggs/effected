---
"@effected/lockfiles": minor
---

## Features

`Lockfile.parse` now reads a pnpm config-dependency-only lockfile — the env preamble plus an empty main document that pnpm 11 and 12 write when a workspace root carries no `package.json` — as a valid, empty lockfile. `lockfileVersion` is taken from the preamble in that shape. Closes #845.

## Breaking Changes

`Lockfile.parse` now fails a pnpm YAML stream of more than two documents with `LockfileFramingError` and reason `"unexpectedDocuments"`, where it previously read the last document regardless of how many preceded it. This is the same framing rule `PnpmEnvLockfile` already enforced — both readers now share one document splitter, so a malformed or unexpectedly multi-document pnpm lockfile is rejected consistently everywhere it's parsed. Public types are unchanged.
