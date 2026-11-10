# @effected/mcp

The `effected-mcp` server: a front end of the `effected` tool, on `effect/ai` and
`@effected/mcp-kit`. Application package, no library tier. A consumer installs
`@effected/plugin`, not this package. (The MCP boundary library is
`@effected/mcp-kit`.)

## Import

```ts
import { MCP_VERSION, main } from "@effected/mcp";
import { main } from "@effected/mcp/main";
```

## Core API

- **`main(options?)`** — runs the server over stdio and owns the process, under
  `McpGuard.run` with a lazy load so a failure while the server graph evaluates
  is still reported on stderr. `options.distribution` names the carrier the bin
  was installed through.
- **The `identity` tool** — the tool name, this front end's version, the carrier
  `distribution` (or `null`), and the resolved `effect` version, as a real tool
  result.
- **`schema_check`, `schema_validate`, `schema_build`** — the `effected schema`
  commands as tools. `schema_check` and `schema_validate` are read-only;
  `schema_build` writes. They take `config`, `drift`, `onDrift` and `force`
  (`schema_validate` takes `payload` and `schema`).
- **`package_build`** — `effected package build` as a tool (`cwd?`, `noExe?`). A
  build that crashes or records an error is the verdict `failed` with its
  issues, not an error; an error means the config or a plugin would not load,
  the directory is not a package or lies outside the workspace root, or another
  build of the same package held its build lock for the whole wait.
- **`action_build`** — `effected action build` as a tool (`cwd?`, `validate?`,
  `persist?`). `persist` defaults to false, so it writes only `dist`; `true` also
  writes `.github/actions/local`, `.actrc` and `.github/workflows/act-test.yml`.
  The load check imports each bundle unless `[action.build] importCheck` is false;
  a worker's own table can set `importCheck = false` to skip that worker alone.
- **`action_init`** — `effected action init` as a tool (`cwd?`, `name?`,
  `description?`, `force?`), answering `ActionInitResult`. An existing file
  without `force`, a symbolic link or wrong-kind entry at any path it writes
  (refused even with `force`, so no write leaves `cwd`), a directory with no
  `package.json`, and a missing or invalid name or description are refusals,
  with nothing written. It edits no `package.json`;
  the result names the dependencies to add.
- **`MCP_VERSION`** — this package's own version, replaced at build.

Stdout is the JSON-RPC wire; nothing here writes to it. The `effected-mcp` bin is
declared here and again by `@effected/plugin`. Shared logic belongs in
`@effected/engine`; tests drive the server through `McpHarness` from
`@effected/mcp-kit/testing`.

## The schema tools' contract

- Drift, staleness and a payload that does not conform are ordinary results with
  the verdict and each changed document's diff. Only a config that fails to load
  or a broken engine is a tool error.
- A path the caller passes is confined to the workspace root, and config
  discovery stops there. A config's own output paths are not confined.
- A result carries a `versionMismatch` warning when the config's
  `@effected/schemastore` is not the tool's; the tool runs anyway.
- A long-running server reloads a `.ts`, `.mts`, untyped `.js` or `.json` config
  on every call. A `.mjs`, `.cjs` or `.js` config under `"type": "module"`, and a
  sibling package's built output, need a server restart to pick up an edit.
- The result is not the CLI's `--format=json` document. The MCP `report` is the
  `RunReport` class encoding (`onDrift` and `policy` flat; `frozen`, `conflicts`
  and `invalid` always present), where the CLI document nests
  `drift: { onDrift, policy? }` and omits empty arrays. `RunReport.Json`
  decodes the CLI document into the class.
- `validate` findings carry `location: { file, line, column }`, one-based,
  whenever the payload parses.
