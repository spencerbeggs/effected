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

## The MCP crash-guard requirement

An MCP server's `main.ts` needs one thing no other front end does: its
`uncaughtException` and `unhandledRejection` handlers must be registered
**before any static import of the server graph**, then the rest of the
module loaded with a dynamic `await import(...)`. Reason: MCP servers talk
over stdio, and a throw during static module evaluation — before those
handlers exist — dies silently behind the transport instead of reaching
stderr where anyone can see it.

okfit's `packages/mcp/src/main.ts` states the rule directly in its own
doc comment and both okfit and vitest-agent implement it the same way:

```ts
// This module deliberately carries NO static imports of the server graph:
// the `uncaughtException` and `unhandledRejection` handlers are registered
// before `NodeRuntime`, the logger and `ServerLayer` are ever evaluated, so
// a throw during module evaluation is still reported on stderr rather than
// crashing silently.
export const main = async (options: MainOptions = {}): Promise<void> => {
  process.on("uncaughtException", (error) => fatal("uncaught exception", error));
  process.on("unhandledRejection", (reason) => fatal("unhandled rejection", reason));

  const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
  const { OkfitPlatform } = await import("@okfit/engine");
  // ...the rest of the server graph, all dynamically imported
};
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/main.ts>)

Document this inline wherever it appears — the dynamic imports read, at a
glance, like something a future edit would "tidy" back into static ones.
That edit reintroduces the exact silent-crash failure mode the pattern
exists to close.

A CLI's `main.ts` has no equivalent need — it owns the process the same
way, but there is no stdio transport swallowing a stack trace, so a plain
static import graph is fine. okfit's `packages/cli/src/main.ts` is a
representative shape: it resolves a `Now` test hook once, provides the
`Distribution` reference (see
[carrier-version-threading.md](./carrier-version-threading.md)), maps a
`ShowHelp` result to the right exit code, and calls `NodeRuntime.runMain`
last, after every layer is composed
(<https://github.com/spencerbeggs/okfit/blob/main/packages/cli/src/main.ts>).

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
#!/usr/bin/env node
import { main } from "@scope/cli/main";
import { PLUGIN_VERSION } from "../version.js";

main({ distribution: { name: "@scope/plugin", version: PLUGIN_VERSION } });
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
