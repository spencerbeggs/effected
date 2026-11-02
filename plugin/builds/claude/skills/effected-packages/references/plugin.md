# @effected/plugin

The carrier of the `effected` tool: a package with no API of its own, installed so
its two bins arrive. It is an application package rather than a library, so no
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
the root. Do not install `@effected/cli`, `@effected/mcp` or `@effected/engine`
directly.

## What it provides

- **`effected`** — the command. `effected --version` prints
  `effected <version> via @effected/plugin <version>`; `--help` lists the command
  tree. Version and help are all it does today.
- **`effected-mcp`** — the stdio MCP server, with one `identity` tool reporting the
  tool version, the carrier, and the resolved `effect` version. The effected agent
  plugin launches it, and falls back to a one-off run of `@effected/mcp` with the
  install line printed when the bin is not installed.

Each bin is a shim calling its front end's `main()` with
`distribution: { name: "@effected/plugin", version }`. The front ends declare the
same bin names so each also installs alone; the carrier's shims are the ones a
carrier install runs.

## Exports

`PLUGIN_VERSION` only (the package's own version, replaced at build). Nothing
else belongs here; shared logic lives in `@effected/engine`.
