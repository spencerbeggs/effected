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
the root. `typescript` is a peer (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`), which the
build needs. Do not install `@effected/cli`, `@effected/mcp` or `@effected/engine`
directly. `@effected/mcp` alone also works when only the MCP tools are wanted.

## What it provides

- **`effected`** — the command. `effected --version` prints
  `effected <version> via @effected/plugin <version>`; `--help` lists the command
  tree. `effected schema build|check|validate` publishes and drift-checks
  SchemaStore documents (see [cli.md](./cli.md); the procedure is the
  `building-schemastore-schemas` skill). `effected package build` builds a
  library into `dist/prod`, and `effected action build` bundles a GitHub Action
  into `dist`; both are configured by `effected.toml`. `effected action init`
  scaffolds a new action's `[action]` tables, `action.yml`, entry and tsconfig.
- **`effected-mcp`** — the stdio MCP server: an `identity` tool reporting the
  tool version, the carrier, and the resolved `effect` version, and the
  `schema_check`, `schema_validate`, `schema_build`, `package_build`, `action_build` and `action_init` tools (see
  [mcp.md](./mcp.md)). The effected agent
  plugin launches it, and falls back to a one-off run of `@effected/mcp` with the
  install line printed when the bin is not installed.

Each bin is a shim calling its front end's `main()` with
`distribution: { name: "@effected/plugin", version }`. The front ends declare the
same bin names so each also installs alone; the carrier's shims are the ones a
carrier install runs.

## A repository that runs its own bins from source

Consuming `@effected/plugin` from the registry runs a built bin and needs none of this. A repository whose root depends on **its own** carrier through `workspace:*` runs that carrier's bins from source, with two rules:

- **The bin registers tsx itself.** `.bin/<tool>` under a hook, an MCP loader or a bare shell has no `nodeOptions`, so the bin file carries the guarded import (see `effect-v4-cli`'s [bin-only-package](../../effect-v4-cli/references/bin-only-package.md)), with `tsx` as a root devDependency. The contract: a SOURCE bin self-registers tsx; a BUILT bin's self-registration branch is dead, and in a linked workspace that built bin still imports siblings from source, so a test that spawns a built bin in the workspace passes `--import <absolute file URL of tsx>` (as the kit's own `packages/cli/__test__/e2e/*.e2e.test.ts` do); an installed consumer needs nothing.
- **Every `.tsx` file starts with `/** @jsxRuntime automatic */`.** tsx applies one tsconfig per process, found from the working directory, so a linked package's JSX can compile to classic `React.createElement` and a TTY run of a live view fails with `React is not defined` while a captured run stays green. A tsconfig setting depends on where the process starts, and the pragma does not. The kit tracks no `.tsx` under `packages/*/src`, so it is not exposed.
- **`nodeOptions: --import=tsx` in `pnpm-workspace.yaml` is repo-global.** Every process a pnpm script starts inherits it, and a tool that loads its own bundles can break: `rspress build` is the known case. The escape is `NODE_OPTIONS=` at the front of that script. A `pnpm install` started from a script or `pnpm exec` needs the same escape: with no `node_modules`, the inherited `--import=tsx` kills the Node process that loads pnpmfiles before tsx is installed. A root `build` script also uses `--filter=!docs` when a website package has its own `build` task.

## Exports

- **`defineSchemastore`** — `defineConfig` from `@effected/schemastore` under the
  tool's name: the default export of `schemastore.config.ts`. A repository with
  only `@effected/mcp` installed imports `defineConfig` from
  `@effected/schemastore` instead.
- **`@effected/plugin/tsconfig/ecma.json`, `action.json` and `root.json`** — the tsconfig
  presets a package, an action or the workspace root extends: `"extends": "@effected/plugin/tsconfig/ecma.json"`.
  `action.json` is the one for a GitHub Action: `bundler` resolution and `noEmit`, no `incremental`
  and no build-info file under `dist/` (the bundle is the shipped artifact).
- **`PLUGIN_VERSION`** — the package's own version, replaced at build.

Nothing else belongs here; shared logic lives in `@effected/engine`.
