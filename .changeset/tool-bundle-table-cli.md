---
"@effected/cli": minor
---

## Breaking Changes

### `[package.tsdoctor]` is `[package.bundle]`

`effected package build` and the `package_build` MCP tool read the documentation-manifest table of `effected.toml` as `[package.bundle]`. The old `[package.tsdoctor]` table fails the build, and the error says it was renamed.

* The emitted sidecar and its source files are `bundle.json`, not `tsdoctor.json`
* A source file still named `tsdoctor.json` is not read, and the build warns `bundle-manifest-retired-source`
* Rename the table and `git mv` each `tsdoctor.json` to `bundle.json`

## Features

* `effected action init` and the `action_init` MCP tool scaffold a `tsconfig.json` that extends `@effected/plugin/tsconfig/action.json`
