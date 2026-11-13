# @effected/engine

## 0.18.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.6.0 | 0.6.1 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.33.0 | 0.33.1 |
| @effected/workspaces | dependency | updated | 0.47.1 | 0.48.0 |

## 0.18.0

### Features

- `ConfigLoader.load` resolves `effect/Schema` beside the config, through the same jiti that loaded it, and returns its generator as the new `LoadedConfig.toJsonSchemaDocument`.
- `RunOptions.toJsonSchemaDocument` is new, and `SchemaRun` lowers schemas with it, falling back to the tool's own `effect` copy when none resolves beside the config.
- `SchemaRunDeps.toJsonSchemaDocument` is new. A caller that loads the config itself and passes it in through `importModule` uses it to hand over the generator that load resolved.
- `effected action init` now opens the `effected.toml` it scaffolds with a `#:schema` directive naming the published `effected.toml` JSON Schema, so tombi, taplo and other TOML editors complete and validate it.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.33.0 |
| @effected/workspaces | dependency | updated | 0.47.0 | 0.47.1 |

## 0.17.2

### Bug Fixes

- The schemastore version-mismatch remedy now names the `@effected/plugin` authoring surface as the way to build a config the tool's version check accepts

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.4.1 | 0.5.0 |
| @effected/files | dependency | updated | 0.3.0 | 0.3.0 |
| @effected/jsonl | dependency | updated | 0.19.0 | 0.19.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |
| @effected/workspaces | dependency | updated | 0.47.0 | 0.47.0 |
| effect | dependency | updated | 4.1.3 | 4.1.4 |

## 0.17.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/files | dependency | updated | 0.3.0 | 0.3.0 |
| @effected/jsonl | dependency | updated | 0.19.0 | 0.19.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |
| @effected/workspaces | dependency | updated | 0.46.0 | 0.47.0 |

### Maintenance

- Pins every `@effected/*` dependency to the exact version the tool was built and tested with, so a newer kit patch never reaches an installed tool without a release of the tool. Each library's kit peers resolve from these pins, so a consumer's other kit versions no longer split the tool's graph.

## 0.17.0

### Breaking Changes

- `BuildRun.run` can now fail with `BuildLockTimeoutError`. A caller that handles the run's failures by tag adds that case; a `BuildProgress` consumer that matches exhaustively adds `Waiting`.

### Features

#### A build of one package waits for another

- `BuildRun.run` serialises builds of the same package on a lock under `.cache/effected/locks`, so a second build waits instead of cleaning `dist` under the first. A lock whose process is dead is reclaimed, and the lock is released on failure or interruption.

- `BuildLockHolder` describes the process holding the lock: its pid, working directory and start time

- `BuildLockOptions` sets how a build waits, and `BuildRunDeps.lock` carries it

- `BuildLockTimeoutError` is the failure when the lock is held for the whole wait

- `BuildProgress` gains a `Waiting` variant, sent to `onProgress` while the build waits, with the lock path and the holder as an `Option`

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.32.0 |
| @effected/workspaces | dependency | updated | 0.45.0 | 0.46.0 |

## 0.16.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.2.1 | 0.3.0 |
| @effected/files | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/jsonc | dependency | updated | 0.24.0 | 0.25.0 |
| @effected/jsonl | dependency | updated | 0.18.1 | 0.19.0 |
| @effected/kit | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/schemastore | dependency | updated | 0.31.1 | 0.32.0 |
| @effected/source | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/workspaces | dependency | updated | 0.44.2 | 0.45.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.15.1

### Bug Fixes

- `@effected/engine` now peers `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` (`^26.6.0`). It depends on `@effected/bundler`, which requires both, but did not declare them itself, so installing the engine on its own left both of the bundler's required peers unmet. The engine imports nothing from either. Installs of `@effected/plugin`, `@effected/cli` or `@effected/mcp` are unchanged, because each already declared these peers. [#1318][#1318]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/jsonl | dependency | updated | 0.18.0 | 0.18.1 |
| @effected/schemastore | dependency | updated | 0.31.0 | 0.31.1 |
| @effected/workspaces | dependency | updated | 0.44.1 | 0.44.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1318]: https://github.com/spencerbeggs/effected/pull/1318

## 0.15.0

### Breaking Changes

#### `[package.tsdoctor]` is `[package.bundle]`

- `effected package build` and the `package_build` MCP tool read the documentation-manifest table of `effected.toml` as `[package.bundle]`. The old `[package.tsdoctor]` table fails the build, and the error says it was renamed.

- The emitted sidecar and its source files are `bundle.json`, not `tsdoctor.json`

- A source file still named `tsdoctor.json` is not read, and the build warns `bundle-manifest-retired-source`

- Rename the table and `git mv` each `tsdoctor.json` to `bundle.json`

### Features

- `effected action init` and the `action_init` MCP tool scaffold a `tsconfig.json` that extends `@effected/plugin/tsconfig/action.json` [#1310][#1310]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/workspaces | dependency | updated | 0.44.0 | 0.44.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.14.0

### Features

#### Scaffold a GitHub Action

- `effected action init` and the `action_init` MCP tool scaffold a new GitHub Action in a package directory: the `[action]` table of `effected.toml`, `action.yml`, `src/main.ts`, `src/program.ts` and `tsconfig.json`, ready for `effected action build`.

- It refuses, writing nothing, when any of those files exists, unless `--force` is given. `--force` never overrides a conflict

- It always refuses a symbolic link, a case variant of a target name, or a write outside the package directory

- It edits no `package.json`: it reports the missing dependencies to add instead

- The command exits 0 on success, 2 on a refusal and 3 when the run cannot finish [#1295][#1295]

* Adds a `./build` subpath with `BuildRun` and `ActionRun`, the engine side of package and action builds, and their result classes `BuildRunResult` and `ActionRunResult`; it also re-exports the bundler's `ActionValidation`, whose `isCI` answers the CI question the way `@effected/env` does [#1249][#1249]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/bundler | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/files | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/schemastore | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/workspaces | dependency | updated | 0.43.0 | 0.44.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295

## 0.13.0

### Features

- `effected schema build` writes schema documents and catalog files atomically (#1234). A reader sees the old file or the new one, though a build still writes several files in turn.

- `syncFile` now fails with `SchemaFileWriteError` naming the slice the user asked for, rather than a bare platform error naming a temp.

- The output directories need write permission. [#1237][#1237]

* New `@effected/engine/schema` subpath: the schema runner, report schemas, config loader, validators and version check that back `effected schema build|check|validate` and the matching MCP tools. [#1233][#1233]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.23.0 | 0.24.0 |
| @effected/kit | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/schemastore | dependency | updated | 0.29.0 | 0.30.0 |
| @effected/source | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/files | dependency | added | — | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

[#1237]: https://github.com/spencerbeggs/effected/pull/1237

## 0.12.0

### Breaking Changes

- `@effected/engine` is now the `effected` tool's shared engine, not the kit's cross-front-end primitives library. That library moved to `@effected/kit` with the same exports; anything that imports or depends on `@effected/engine` for it must move to `@effected/kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

### Features

- `Identity.report` and the `IdentityReport` schema class: the identity the `effected` command and the `effected-mcp` server both report. [#1229][#1229]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/kit | dependency | updated | 0.11.0 | 0.12.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229
