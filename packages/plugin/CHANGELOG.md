# @effected/plugin

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
