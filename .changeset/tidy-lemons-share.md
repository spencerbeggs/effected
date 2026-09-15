---
"@effected/schemastore-cli": minor
---

## Features

Pre-flight now reads each frozen file and verifies its `$id`: a run fails with `FrozenVersionIdMismatchError` when a frozen file's `$id` is absent, differs from the derived one, or the file's text does not parse. A `baseUrl` change on a hosted schema is a re-publish event for every frozen label it affects, and this catches it before a stale file ships.

`check` and `build` now report an `orphaned` catalog: when no schema declares a `catalog` but a file already exists at `config.catalogPath`, `check` reports it stale (exit 1) and `build` reports it without deleting it.

`ConfigLoader` now requires `frozen[].$id` on a loaded config — a config built by an older `@effected/schemastore` is rejected as malformed rather than silently accepted.
