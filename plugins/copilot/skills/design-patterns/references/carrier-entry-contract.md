# Carrier entry contract

Every front end in the carrier pattern (see
[carrier-package.md](./carrier-package.md)) ships the same four files, each
with one job:

| File | Role | Exported as |
| --- | --- | --- |
| `src/bin.ts` | shebang; import `main`; call it. Nothing else. A workspace-local entry for running the front end directly during development | **not** declared as a `bin`: only the carrier declares bins (see [below](#only-the-carrier-declares-a-bin)) |
| `src/main.ts` | the assembled program: crash guards, environment resolution, exit-code mapping, runtime teardown, `runMain`. **Owns the process.** | `./main` subpath export |
| `src/index.ts` | the programmatic barrel — side-effect free, never exports `main` | `.` (package root) |
| `src/version.ts` | `export const X_VERSION = process.env.__PACKAGE_VERSION__ ?? "0.0.0"` — a bundler `define`, not a runtime read | not exported directly; consumed internally |

A front end's `package.json` exports map is:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./main": "./src/main.ts",
    "./package.json": "./package.json"
  }
}
```

No `bin` field: the carrier's shim is the only published way to run it.

## Why `./main`, not `.`

`index.ts` has to be importable with zero side effects — a consumer, or
another package in the workspace, can import it purely to read types or
constants without spinning up a runtime. `main.ts` is the opposite: it
registers process handlers and sets exit codes the moment it runs. Splitting
them into two export paths means "give me the program's shape" and "run the
program" are never the same import.

## An MCP front end's `main.ts`

`@effected/mcp`'s `McpStdio.launch` and `McpStdio.teardown` are the whole
assembly — a front end no longer hand-rolls the launch/report/teardown
sequence:

```ts
import { McpStdio } from "@effected/mcp"
import { NodeRuntime } from "@effect/platform-node"
import type { Layer } from "effect"

// A consumer's own fully-composed server layer.
declare const Main: Layer.Layer<never, Error>

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown })
```

The crash-guard requirement below still applies and is not something
`McpStdio` replaces — it is a `main.ts`-authoring discipline that sits
**around** `McpStdio.launch`, not inside it. Full detail, including both
shipped crash-guard policies and when to choose each, lives in
`effect-v4-mcp`'s
[`server-wiring.md#crash-guards`](../../effect-v4-mcp/references/server-wiring.md#crash-guards) —
this file only names the requirement, since the depth belongs to the skill
that owns MCP knowledge (see this skill's own **Related skills** line).

An MCP server's `main.ts` needs one thing no other front end does: its
`uncaughtException` and `unhandledRejection` handlers must be registered
**before any static import of the server graph**, then the rest of the
module loaded with a dynamic `await import(...)`. Reason: a static `import`
runs before any code in the file does, so a throw while the server graph is
being evaluated happens before those handlers exist. Node still prints that
throw on stderr and exits `1` by itself; what the guards buy is the server's
**own** handler — its message prefix, its exit policy — being in place in
time to run instead of Node's default. Document this inline wherever it
appears — the dynamic imports read, at a glance, like something a future
edit would "tidy" back into static ones, and that edit quietly moves every
startup throw back to Node's default handler, past the policy the server
chose.

A CLI's `main.ts` has no equivalent need — it owns the process the same
way, and Node's own report of a startup throw (the stack on stderr, exit
`1`) is already what a person at a terminal needs, so a plain static import
graph is fine.

## A CLI front end's `main.ts`

`@effected/cli`'s `CliRuntime.main` is the equivalent whole-assembly move
for a CLI: a fresh `CliExit`, the platform layer inside failure reporting,
and the logger outermost, in the one order that reports every failure well.
`effect-v4-cli`'s
[`recipes.md#the-main-assembly`](../../effect-v4-cli/references/recipes.md#the-main-assembly)
is the full file layout (`bin.ts`/`main.ts`/`index.ts`/`version.ts`) built
around it — reach for that reference rather than assembling `main.ts` by
hand; the depth for a CLI front end lives there, not in this file.

## Resolving the project directory

Both front ends resolve where a tool launched by an agent host should treat
as its project the same way: `@effected/engine`'s `LaunchContext.projectDir`,
over caller-supplied `argv`/`env`/`cwd`, where `argv` is **positional
arguments only** — a raw `process.argv.slice(2)` makes the first flag the
project directory. An MCP front end has no command parser, so its `main.ts`
filters the flags out or resolves from an env var alone; a CLI front end's
positionals exist only once its command has parsed them, inside the
handler (see `effected-packages`' `engine.md`). See `effect-v4-mcp`'s
[`server-wiring.md#project-directory`](../../effect-v4-mcp/references/server-wiring.md#project-directory)
for the runnable shape and why `LaunchContext.isUnsubstituted` matters — a
plugin host can pass a literal, unexpanded `${CLAUDE_PROJECT_DIR}` through,
and treating that as a real path is the bug the resolver exists to avoid.

## The carrier's shims

The carrier's own `package.json` takes a **regular** `dependencies` edge on
every front end (never `peerDependencies` — see
[carrier-package.md](./carrier-package.md)) and ships one bin per front end,
the only bins any package in the tool declares:

```json
{
  "dependencies": {
    "@scope/cli": "workspace:*",
    "@scope/mcp": "workspace:*"
  },
  "bin": {
    "tool": "./src/bin/tool.ts",
    "tool-mcp": "./src/bin/tool-mcp.ts"
  }
}
```

Each shim is a few lines: import the front end's `./main` export, pass its
own identity down, call it.

```ts
// A consumer's own front end and version constant.
declare const main: (options: { readonly distribution?: { readonly name: string; readonly version: string } }) => void
declare const PLUGIN_VERSION: string

main({ distribution: { name: "@scope/plugin", version: PLUGIN_VERSION } })
```

okfit's `packages/plugin/src/bin/okfit.ts` is exactly this shape
(<https://github.com/spencerbeggs/okfit/blob/main/packages/plugin/src/bin/okfit.ts>).

**Shims are not a rebuild.** The bundler externalizes the front-end import,
so the built shim keeps the literal `import { main } from "@scope/cli/main"`
line rather than inlining the front end's code — systems pins this
behavior with a dedicated `externals.test.ts` so a future bundler config
change that starts inlining front ends fails a test instead of silently
bloating every shim.

## Only the carrier declares a bin

Front ends declare **no** `bin` — above all none with a name the carrier
declares. The carrier's shim is the one executable a consumer installs.

Why: under npm, Yarn (`node-modules` linker) and bun **flat** installs, a
transitive front end that declared a bin of the same name could take the
carrier's `.bin` slot, and which one wins is the manager's choice, not
yours: packed-install runs observed npm and bun linking the front end's bin
over the carrier's. Both call the same `main()`, so the tool still works,
but the carrier identity is lost — the front end runs without the
distribution the shim passes down, and `--version` drops its
`via @scope/plugin <version>` suffix. Only pnpm's isolated layout, which
links nothing transitive at the top level, kept the carrier's shim. With
one declaration there is nothing to shadow, and the identity holds under
every manager.

Consequences:

- Running a front end without installing the tool goes through the
  carrier: `npx --yes -p @scope/plugin@<MAJOR> tool-mcp`, never
  `npx @scope/mcp` (see
  [carrier-plugin-loader.md](./carrier-plugin-loader.md)).
- `src/bin.ts` stays as the workspace-local development entry; it is simply
  not published as a bin.
- `PackedInstall.run` (`@effected/workspaces/testing`) enforces the rule: a
  packed package other than the carrier declaring one of the carrier's bin
  names fails `BinConflict` before any install (see
  [carrier-verification.md](./carrier-verification.md)); `allowSharedBins`
  opts a tool out while it migrates.
- Migrating is breaking for the front ends: anyone who installed or `npx`'d
  a front end directly for its bin loses it. Drop a front end's `bin` in a
  major bump, and move the plugin loader's fallback to the carrier form in
  the same release.
