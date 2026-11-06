# @effected/plugin

The carrier of the `effected` tool: installed so its two bins arrive, and exporting
`defineSchemastore` for a `schemastore.config.ts`. It is an application package rather than a library, so no
library tier applies (the tool packages carry none, like the companions).

## Install

The one tool package a consumer installs, as a root devDependency:

```json
{
  "devDependencies": {
    "@effected/plugin": "catalog:effected"
  }
}
```

`catalog:effected` comes from `@effected/pnpm-plugin-effected`, which also hoists
this package publicly so its bins resolve from any workspace package, not only
the root. `typescript` is a peer (`7.1.0-beta || 7.1.0-rc || >=7.1.0 <8`), which the
build needs. Do not install `@effected/cli`, `@effected/mcp` or `@effected/engine`
directly. `@effected/mcp` alone also works when only the MCP tools are wanted.

## What it provides

- **`effected`** — the command. `effected --version` prints
  `effected <version> via @effected/plugin <version>`; `--help` lists the command
  tree. `effected schema build|check|validate` publishes and drift-checks
  SchemaStore documents (see [cli.md](./cli.md); the procedure is the
  `building-schemastore-schemas` skill). `effected package build` builds a
  library into `dist/prod`, and `effected action build` bundles a GitHub Action
  into `dist`; both are configured by `effected.toml`.
- **`effected-mcp`** — the stdio MCP server: an `identity` tool reporting the
  tool version, the carrier, and the resolved `effect` version, and the
  `schema_check`, `schema_validate`, `schema_build`, `package_build` and `action_build` tools (see
  [mcp.md](./mcp.md)). The effected agent
  plugin launches it, and falls back to a one-off run of `@effected/mcp` with the
  install line printed when the bin is not installed.

Each bin is a shim calling its front end's `main()` with
`distribution: { name: "@effected/plugin", version }`. The front ends declare the
same bin names so each also installs alone; the carrier's shims are the ones a
carrier install runs.

## Exports

- **`defineSchemastore`** — `defineConfig` from `@effected/schemastore` under the
  tool's name: the default export of `schemastore.config.ts`. A repository with
  only `@effected/mcp` installed imports `defineConfig` from
  `@effected/schemastore` instead.
- **`@effected/plugin/tsconfig/ecma.json` and `root.json`** — the tsconfig presets
  a package or the workspace root extends: `"extends": "@effected/plugin/tsconfig/ecma.json"`.
- **`PLUGIN_VERSION`** — the package's own version, replaced at build.

Nothing else belongs here; shared logic lives in `@effected/engine`.
