---
"@effected/plugin": minor
---

## Breaking Changes

### `[package.tsdoctor]` is `[package.bundle]`

`effected package build` and the `package_build` MCP tool read the documentation-manifest table of `effected.toml` as `[package.bundle]`. The old `[package.tsdoctor]` table fails the build, and the error says it was renamed.

* The emitted sidecar and its source files are `bundle.json`, not `tsdoctor.json`
* A source file still named `tsdoctor.json` is not read, and the build warns `bundle-manifest-retired-source`
* Rename the table and `git mv` each `tsdoctor.json` to `bundle.json`

## Features

### `@effected/plugin/env`

An ambient, types-only declaration of `process.env.__PACKAGE_VERSION__`, the define every build sets. It replaces `@savvy-web/bundler/env`:

```ts
/// <reference types="@effected/plugin/env" />
```

A package that does not set `noPropertyAccessFromIndexSignature` needs no reference, since the index signature already types the read.

### `@effected/plugin/tsconfig/action.json`

A tsconfig preset for GitHub Actions, a drop-in for `@savvy-web/github-action-builder/tsconfig/action.json`: ESNext modules with bundler resolution, `noEmit`, and excludes that resolve against the extending project. `effected action init` now scaffolds onto it.

```json
{ "extends": "@effected/plugin/tsconfig/action.json" }
```
