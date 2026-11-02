# @effected/engine

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
