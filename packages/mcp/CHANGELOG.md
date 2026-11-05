# @effected/mcp

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
