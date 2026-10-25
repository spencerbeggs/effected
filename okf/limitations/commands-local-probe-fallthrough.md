---
type: Limitation
title: "A tool installed only globally also probes as local, because the package manager's exec falls through to PATH"
description: "ToolDiscovery's local probe runs the tool through the launcher (pnpm exec, npx --no --, …), which also finds a PATH-only tool, so a global-only tool such as git reads as present in both places with equal versions and, under prefer local, resolves to pnpm exec git."
status: draft
bounds: ../modules/commands.md
tags: [dx, performance]
sources:
  - id: tool-resolution-ts
    resource: ../../packages/commands/src/internal/toolResolution.ts
  - id: tool-discovery-sync-ts
    resource: ../../packages/commands/src/ToolDiscoverySync.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-25T19:59:29Z
integrity:
  generated:
    body: ff734bf19dfbd9c3
  verified:
    by: human:spencer
    at: 2026-10-25T20:07:35Z
    content: 67eef0cb98bb7b9c
verified:
  - by: human:spencer
    at: 2026-10-25T20:07:35Z
---

# A tool installed only globally also probes as local, because the package manager's exec falls through to PATH

## The condition

A `Tool` with `source: "any"` (or `"both"`) is resolved inside a project
whose `LocalExec` context names a launcher, and the tool is installed only
globally — `git` is the common case. Both `ToolDiscovery` and
`makeToolDiscoverySync` share the probe.[^tool-resolution-ts][^tool-discovery-sync-ts]

## The symptom

The local probe runs `pnpm exec git --version` (or the other launchers'
equivalent). The launcher searches `node_modules/.bin` and then falls
through to `PATH`, so it finds the global `git`, exits 0, and reports the
same version as the global probe. Discovery sees two agreeing copies, and
under the default `prefer: "local"` resolves to `source: "local"` —
`ResolvedTool.argv("status")` is `["pnpm", "exec", "git", "status"]`.

## Why this is acceptable

The resolution is correct in effect: `pnpm exec git` runs the same binary
the bare `git` would. The cost is one extra launcher hop per run, and the
`source` field reads `"local"` for a tool with no project-local copy. A
caller that knows a tool is never project-local says so with
`Tool.named(name, { prefer: "global" })` or `source: "global"`.

Telling a real `node_modules/.bin` entry from a `PATH` fall-through needs
filesystem access, which `@effected/commands` deliberately does not have:
it takes no `@effected/*` edges and requires only core's spawner in `R`
([the module's one rule](../modules/commands.md#the-one-rule)).

## What a fix would take

Either a `LocalExec` contract extension letting the
`@effected/workspaces` implementation report the bin directory it would
run from, so discovery can ask whether the tool lives there; or a
filesystem-backed check in the implementing package rather than here.
Neither is scheduled.

[^tool-resolution-ts]: `packages/commands/src/internal/toolResolution.ts` —
    `probeFromRun` reads a local exit 0 as found, whatever the launcher
    found it in.
[^tool-discovery-sync-ts]: `packages/commands/src/ToolDiscoverySync.ts` —
    the local probe spawns `context.prefix` plus the tool name.
