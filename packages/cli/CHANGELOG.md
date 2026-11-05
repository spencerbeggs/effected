# @effected/cli

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
