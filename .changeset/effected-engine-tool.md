---
"@effected/engine": minor
---

## Breaking Changes

* `@effected/engine` is now the `effected` tool's shared engine, not the kit's cross-front-end primitives library. That library moved to `@effected/kit` with the same exports; anything that imports or depends on `@effected/engine` for it must move to `@effected/kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

## Features

* `Identity.report` and the `IdentityReport` schema class: the identity the `effected` command and the `effected-mcp` server both report.
