---
"@effected/cli": minor
---

## Features

### effected schema

`effected schema build`, `check` and `validate` run the SchemaStore pipeline from the `effected` tool, with a coloured diff and a live progress view. This replaces the standalone `@effected/schemastore-cli` package; its last published version remains on npm.

## Breaking Changes

* `rootCommand` is replaced by `makeRootCommand`. Call `makeRootCommand` to build the root command instead of importing the constant.
