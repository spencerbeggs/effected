# @effected/plugin

Install this one package to get the `effected` command and the `effected-mcp` server. It depends on `@effected/cli` and `@effected/mcp` and adds a bin shim for each, so both report that they came through this package.

```sh
pnpm add -D @effected/plugin
pnpm exec effected --version
# effected <version> via @effected/plugin <version>
```

The `effected` catalog in `@effected/pnpm-plugin-effected` lists this package, so a consumer writes `"@effected/plugin": "catalog:effected"`. That plugin also hoists this package publicly, so its bins reach every package of a pnpm workspace, even when only one leaf package declares it.

> **Pre-`1.0.0`.** Part of the `@effected/*` kit; unstable across `0.x` releases. Pin an exact version.
