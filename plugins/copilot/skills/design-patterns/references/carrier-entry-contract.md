# Carrier entry contract

Every front end in the carrier pattern (see
[carrier-package.md](./carrier-package.md)) ships the same four files, each
with one job:

| File | Role | Exported as |
| --- | --- | --- |
| `src/bin.ts` | shebang; import `main`; call it. Nothing else. | `bin` in `package.json` |
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
  },
  "bin": { "the-tool": "./src/bin.ts" }
}
```

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
[carrier-package.md](./carrier-package.md)) and ships one bin per front end
that mirrors it:

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

## The mirror-bin wart

Front ends keep their **own** bins too — `@scope/cli`'s `package.json` still
declares `"tool": "./src/bin.ts"`. These are mirrors, not alternatives to
the carrier's shims: both ultimately call the same `main()`. The wart is
that under npm/yarn/bun **flat** installs, a front end's own bin can shadow
the carrier's shim in `.bin` depending on install order — this is harmless
precisely because both paths call the same `main()` and produce identical
behavior. Only a **pnpm isolated** install proves unambiguously that the
carrier's own shim is the one that ran, because pnpm's isolated `node_modules`
does not let a transitive front end's bin land in the top-level `.bin` at
all.
