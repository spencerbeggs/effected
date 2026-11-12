# @effected/mcp

## 0.18.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.17.1 | 0.17.2 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.28.0 |
| effect | dependency | updated | 4.1.3 | 4.1.4 |

## 0.18.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.17.0 | 0.17.1 |
| @effected/kit | dependency | updated | 0.14.0 | 0.14.0 |
| @effected/mcp-kit | dependency | updated | 0.15.0 | 0.15.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.28.0 |

### Maintenance

- Pins every `@effected/*` dependency to the exact version the tool was built and tested with, so a newer kit patch never reaches an installed tool without a release of the tool. Each library's kit peers resolve from these pins, so a consumer's other kit versions no longer split the tool's graph.

## 0.18.0

### Features

#### `package_build` refuses when another build holds the lock

- A call that finds another build of the same package running for the whole wait is refused with a message to wait and call again, or to delete the named lock file if no build is running. `PackageToolOptions.lock` sets how the build waits; omitted, the engine's default applies.

#### Worker import checks in the tool descriptions

- The `action_build` description and the server instructions say a worker's own `[action.entries.workers.<name>]` table can set `importCheck = false` to skip that worker's load check alone.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.16.0 | 0.17.0 |
| @effected/walker | dependency | updated | 0.27.0 | 0.28.0 |

## 0.17.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.15.1 | 0.16.0 |
| @effected/glob | dependency | updated | 0.20.0 | 0.21.0 |
| @effected/kit | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/mcp-kit | dependency | updated | 0.14.1 | 0.15.0 |
| @effected/walker | dependency | updated | 0.26.0 | 0.27.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.16.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.15.0 | 0.15.1 |
| @effected/mcp-kit | dependency | updated | 0.14.0 | 0.14.1 |

## 0.16.0

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

## 0.15.0

### Breaking Changes

- `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies. A consumer without them installed gets a peer warning [#1249][#1249]

### Features

#### Scaffold a GitHub Action

- `effected action init` and the `action_init` MCP tool scaffold a new GitHub Action in a package directory: the `[action]` table of `effected.toml`, `action.yml`, `src/main.ts`, `src/program.ts` and `tsconfig.json`, ready for `effected action build`.

- It refuses, writing nothing, when any of those files exists, unless `--force` is given. `--force` never overrides a conflict

- It always refuses a symbolic link, a case variant of a target name, or a write outside the package directory

- It edits no `package.json`: it reports the missing dependencies to add instead

- The command exits 0 on success, 2 on a refusal and 3 when the run cannot finish [#1295][#1295]

* Adds the `package_build` tool, which builds one package into its `dist/prod`; a failed build arrives as a `failed` verdict with its issues, not as an error
* Adds the `action_build` tool, which builds one GitHub Action from its `effected.toml`. It writes only `dist` unless `persist` is set; `persist` defaults to false

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/glob | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/walker | dependency | updated | 0.25.1 | 0.26.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295

## 0.14.0

### Features

- New MCP tools `schema_build`, `schema_check` and `schema_validate` expose the schema pipeline to agents. [#1233][#1233]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/glob | dependency | updated | 0.18.0 | 0.19.0 |
| @effected/kit | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/mcp-kit | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/walker | dependency | updated | 0.25.0 | 0.25.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

## 0.13.0

### Breaking Changes

- `@effected/mcp` is now the `effected-mcp` server, not the kit's MCP boundary library. That library moved to `@effected/mcp-kit` with the same exports and subpaths (`./testing`, `./guard`, `./node`); anything that imports or depends on `@effected/mcp` for it must move to `@effected/mcp-kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

### Features

- The `effected-mcp` bin, an MCP server over stdio serving one read-only tool, `identity`: the tool name, the server version, the carrier distribution (`null` for a direct install) and the resolved `effect` version. `./main` exports `main(options?)` for a carrier's bin shim. [#1229][#1229]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/kit | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/mcp-kit | dependency | updated | 0.12.0 | 0.13.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229
