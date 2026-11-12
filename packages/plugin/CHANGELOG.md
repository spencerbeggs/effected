# @effected/plugin

## 0.6.0

### Features

#### The carrier bundles the tool

- The published `@effected/plugin` now carries the `effected` tool's kit closure and `effect` 4.1.4 inside its own files. Installing it no longer installs `@effected/*` packages or `effect` alongside it. `effect` is an optional peer, needed only for the config types a `schemastore.config.ts` imports.

#### The whole schemastore authoring surface from one import

- The root entry re-exports everything a `schemastore.config.ts` builds from, so a config imports from `@effected/plugin` and nothing else:

```ts
import { defineSchemastore, HostedSchema, SchemaTarget } from "@effected/plugin";
```

- The surface covers `defineSchemastore`, `HostedSchema`, `SchemaTarget`, `SchemaVersion`, `SchemaVersioning`, `DriftPolicy`, `KeywordFamilies`, `CatalogEntry`, `SchemastoreVersion` and their related types. `defineSchemastore` is the only define name. Every value built from here carries the version the tool was built against, so the tool's version check always passes for it.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.31.1 | 0.31.2 |
| @effected/mcp | dependency | updated | 0.18.1 | 0.18.2 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |
| effect | dependency | updated | 4.1.3 | 4.1.4 |

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.31.0 | 0.31.1 |
| @effected/mcp | dependency | updated | 0.18.0 | 0.18.1 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/mcp | dependency | updated | 0.17.0 | 0.18.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |

## 0.5.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.29.1 | 0.30.0 |
| @effected/mcp | dependency | updated | 0.16.1 | 0.17.0 |
| @effected/schemastore | dependency | updated | 0.31.1 | 0.32.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.29.0 | 0.29.1 |
| @effected/mcp | dependency | updated | 0.16.0 | 0.16.1 |
| @effected/schemastore | dependency | updated | 0.31.0 | 0.31.1 |

## 0.4.0

### Breaking Changes

#### `[package.tsdoctor]` is `[package.bundle]`

- `effected package build` and the `package_build` MCP tool read the documentation-manifest table of `effected.toml` as `[package.bundle]`. The old `[package.tsdoctor]` table fails the build, and the error says it was renamed.

- The emitted sidecar and its source files are `bundle.json`, not `tsdoctor.json`

- A source file still named `tsdoctor.json` is not read, and the build warns `bundle-manifest-retired-source`

- Rename the table and `git mv` each `tsdoctor.json` to `bundle.json`

### Features

#### `@effected/plugin/env`

- An ambient, types-only declaration of `process.env.__PACKAGE_VERSION__`, the define every build sets. It replaces `@savvy-web/bundler/env`:

```ts
/// <reference types="@effected/plugin/env" />
```

- A package that does not set `noPropertyAccessFromIndexSignature` needs no reference, since the index signature already types the read.

#### `@effected/plugin/tsconfig/action.json`

- A tsconfig preset for GitHub Actions, a drop-in for `@savvy-web/github-action-builder/tsconfig/action.json`: ESNext modules with bundler resolution, `noEmit`, and excludes that resolve against the extending project. `effected action init` now scaffolds onto it. [#1310][#1310]

```json
{ "extends": "@effected/plugin/tsconfig/action.json" }
```

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.28.0 | 0.29.0 |
| @effected/mcp | dependency | updated | 0.15.0 | 0.16.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.3.0

### Breaking Changes

- `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies. Install them alongside the plugin, or expect a peer warning

### Features

- `effected package build` now ships with the tool, replacing `@savvy-web/bundler`, and `effected action build` replaces `@savvy-web/github-action-builder`. The `effected-mcp` server gains the matching `package_build` and `action_build` tools
- Adds the tsconfig presets `@effected/plugin/tsconfig/ecma.json` and `@effected/plugin/tsconfig/root.json`

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.27.0 | 0.28.0 |
| @effected/mcp | dependency | updated | 0.14.0 | 0.15.0 |
| @effected/schemastore | dependency | updated | 0.30.0 | 0.31.0 |

### Other

- Upgrading: keep `@effected/plugin` as a root devDependency, never as a package's dependency
- Replace the `@savvy-web/bundler` devDependency and its `build:dev` / `build:prod` / `prepare` scripts with one `"build": "effected package build"` script, and move `savvy.build.ts` settings into `effected.toml`
- Build a GitHub Action with `effected action build` instead of `@savvy-web/github-action-builder` [#1249][#1249]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

## 0.2.0

### Features

- `defineSchemastore` is exported for typing a project's SchemaStore configuration.
- `@effected/plugin` now pins `@effected/cli`, `@effected/mcp` and `@effected/schemastore` to exact versions so the chain installs together. [#1233][#1233]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.26.0 | 0.27.0 |
| @effected/mcp | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.29.0 | 0.30.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

## 0.1.0

### Features

- New package: the effected carrier. Installing `@effected/plugin` provides the `effected` command and the `effected-mcp` server through bin shims that call `@effected/cli` and `@effected/mcp`, so `effected --version` ends with `via @effected/plugin <version>` and the `identity` MCP tool reports the carrier as its distribution. `PLUGIN_VERSION` is exported from the root.
- Install it as a root devDependency with `"@effected/plugin": "catalog:effected"`. [#1229][#1229]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.25.0 | 0.26.0 |
| @effected/mcp | dependency | updated | 0.12.0 | 0.13.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229
