---
"@effected/cli": minor
---

## Breaking Changes

* `@effected/cli` is now the `effected` command, not the kit's CLI presentation library. That library moved to `@effected/cli-kit` with the same exports and subpaths; anything that imports or depends on `@effected/cli` for it must move to `@effected/cli-kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

## Features

* The `effected` bin, answering `--version` and `--help`. `./main` exports `main(options?)`, which a carrier calls with its own `distribution` so `--version` reports `via <carrier> <version>`.
