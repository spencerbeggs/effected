# @effected/plugin

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
