# @effected/cli

## 0.33.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.30.1 | 0.30.1 |
| @effected/engine | dependency | updated | 0.20.1 | 0.20.2 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |

## 0.33.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.30.1 | 0.30.1 |
| @effected/engine | dependency | updated | 0.20.0 | 0.20.1 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |

## 0.33.0

### Breaking Changes

- `ActionBuildFailedError` gained a required `drift` field. Code that constructs it directly must supply the field (`drift: 0` when there is no drift); code that only catches it is unaffected.

- A `[action.persistLocal] path` that `effected action build` used to accept now exits 2 when it resolves outside the workspace, is or contains the package, lands in the package's `dist/` or `.action-staging/`, or is or lies inside another package.

### Features

#### `effected action build --check`

- `--check` builds the action and compares the result with the committed `dist/` and the persisted action directory, writing nothing. A mismatch exits non-zero and lists each drifting file as `changed`, `missing` or `extra`, in the human report, the GitHub step summary and the JSON output. It is meant for CI to prove committed bundles are current.

- These combinations are usage errors (exit 64): `--check --watch`, `--check --no-persist`, `--check` when persisting is disabled in config, and `--no-persist` when `dist = false`. A persist path the bundler refuses (`PersistPathError`) exits 2.

#### `effected action init --local`

- Scaffolds a local-only action: persisted at the workspace root with `base = "workspace"`, `dist = false`, and a `.gitignore` for the staging directory.

```sh
effected action build --check
effected action init --local
```

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.30.0 | 0.30.1 |
| @effected/engine | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |

## 0.32.0

### Features

#### `--watch` on build commands

- `effected package build` and `effected action build` take `--watch`: the build reruns whenever a source file or `effected.toml` changes, until interrupted.

```sh
effected package build --watch
effected action build --watch
```

- A failed rebuild is reported and the watch keeps running.
- Under `--format json` each build reports as JSON Lines.
- A line on stderr names the changed paths before each rebuild.
- Exit codes: `2` for a wrong directory at startup, `3` when the watcher stops, `130` on interrupt, and `64` under CI, where a watch would never end.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.18.2 | 0.19.0 |

## 0.31.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.29.1 | 0.30.0 |
| @effected/engine | dependency | updated | 0.18.1 | 0.18.2 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/glob | dependency | updated | 0.22.0 | 0.23.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.29.0 | 0.30.0 |

## 0.31.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.29.0 | 0.29.1 |
| @effected/engine | dependency | updated | 0.18.0 | 0.18.1 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |

## 0.31.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.28.2 | 0.29.0 |
| @effected/engine | dependency | updated | 0.17.2 | 0.18.0 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/glob | dependency | updated | 0.21.0 | 0.22.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.29.0 |

## 0.31.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.28.2 | 0.28.2 |
| @effected/engine | dependency | updated | 0.17.1 | 0.17.2 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.28.0 |
| effect | dependency | updated | 4.1.3 | 4.1.4 |

## 0.31.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.28.1 | 0.28.2 |
| @effected/engine | dependency | updated | 0.17.0 | 0.17.1 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.28.0 |

### Maintenance

- Takes `ink` from the `effected:build` catalog instead of silk's. The published range is unchanged.

* Pins every `@effected/*` dependency to the exact version the tool was built and tested with, so a newer kit patch never reaches an installed tool without a release of the tool. Each library's kit peers resolve from these pins, so a consumer's other kit versions no longer split the tool's graph.

## 0.31.0

### Features

#### `effected package build` waits for a concurrent build

- When another build of the same package holds its lock, the command prints one line on stderr naming the holder and the lock path, so `--format json` keeps a single document on stdout. If the lock is held for the whole wait, the command exits `3`, the infrastructure tier, instead of racing the other build.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.28.0 | 0.28.1 |
| @effected/engine | dependency | updated | 0.16.0 | 0.17.0 |
| @effected/walker | dependency | updated | 0.27.0 | 0.28.0 |

## 0.30.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.27.2 | 0.28.0 |
| @effected/engine | dependency | updated | 0.15.1 | 0.16.0 |
| @effected/env | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/glob | dependency | updated | 0.20.0 | 0.21.0 |
| @effected/kit | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.26.0 | 0.27.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.29.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.27.1 | 0.27.2 |
| @effected/engine | dependency | updated | 0.15.0 | 0.15.1 |

## 0.29.0

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
| @effected/engine | dependency | updated | 0.14.0 | 0.15.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.28.0

### Breaking Changes

- `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies, because the build runs the TypeScript compiler. A consumer without them installed gets a peer warning [#1249][#1249]

### Features

#### Scaffold a GitHub Action

- `effected action init` and the `action_init` MCP tool scaffold a new GitHub Action in a package directory: the `[action]` table of `effected.toml`, `action.yml`, `src/main.ts`, `src/program.ts` and `tsconfig.json`, ready for `effected action build`.

- It refuses, writing nothing, when any of those files exists, unless `--force` is given. `--force` never overrides a conflict

- It always refuses a symbolic link, a case variant of a target name, or a write outside the package directory

- It edits no `package.json`: it reports the missing dependencies to add instead

- The command exits 0 on success, 2 on a refusal and 3 when the run cannot finish [#1295][#1295]

* Adds `effected package build`, which builds the current package from its `effected.toml`; `--no-exe` skips the single-executable compile and `--verbose` measures gzip sizes for the report
* Adds `effected action build`, which builds a GitHub Action; `--no-validate` skips validation and `--no-persist` skips copying the build to the local action directory
* `effected action build` persists to the local action directory by default (`--no-persist` turns it off), while the MCP `action_build` tool persists only with `persist: true`
* Both commands take `--format` like `effected schema`, and report through the exit code: 0 the build succeeded, 1 the build or its validation failed, 2 the config, a plugin or the directory is at fault (not a package, or not an action), 3 the run could not finish, 64 a usage error
* Both commands decide CI the way `@effected/env` does: a provider marker, or a truthy `CI` or `CONTINUOUS_INTEGRATION` (`false`, `0`, `off`, `no` and empty read as unset), so `CI=false` never makes warnings fatal

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.27.0 | 0.27.1 |
| @effected/engine | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/glob | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/walker | dependency | updated | 0.25.1 | 0.26.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295

## 0.27.0

### Breaking Changes

- `rootCommand` is replaced by `makeRootCommand`. Call `makeRootCommand` to build the root command instead of importing the constant. [#1233][#1233]

### Features

#### effected schema

- `effected schema build`, `check` and `validate` run the SchemaStore pipeline from the `effected` tool, with a coloured diff and a live progress view. This replaces the standalone `@effected/schemastore-cli` package; its last published version remains on npm.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.26.0 | 0.27.0 |
| @effected/engine | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/env | dependency | updated | 0.10.0 | 0.11.0 |
| @effected/glob | dependency | updated | 0.18.0 | 0.19.0 |
| @effected/kit | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/walker | dependency | updated | 0.25.0 | 0.25.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

## 0.26.0

### Breaking Changes

- `@effected/cli` is now the `effected` command, not the kit's CLI presentation library. That library moved to `@effected/cli-kit` with the same exports and subpaths; anything that imports or depends on `@effected/cli` for it must move to `@effected/cli-kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

### Features

- The `effected` bin, answering `--version` and `--help`. `./main` exports `main(options?)`, which a carrier calls with its own `distribution` so `--version` reports `via <carrier> <version>`. [#1229][#1229]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli-kit | dependency | updated | 0.25.0 | 0.26.0 |
| @effected/env | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/glob | dependency | updated | 0.17.0 | 0.18.0 |
| @effected/kit | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/walker | dependency | updated | 0.24.0 | 0.25.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229
