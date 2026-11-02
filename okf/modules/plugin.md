---
type: Module
title: "@effected/plugin"
description: "The effected tool's carrier: the one package a consumer installs as a root devDependency, declaring the effected and effected-mcp bins as shims that pass its own distribution identity to the CLI and MCP front ends."
status: draft
kind: package
resource: ../../packages/plugin
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T16:44:32Z
integrity:
  generated:
    body: 75196fbef8634fa0
---

# @effected/plugin

`@effected/plugin` is the carrier of the [effected tool](../decisions/one-tool-beside-the-libraries.md), shaped like `@savvy-web/silk`, `@vitest-agent/plugin` and `@okfit/plugin`. A consumer writes `"@effected/plugin": "catalog:effected"` as a root devDependency and receives both bins; nothing recommends installing [cli](cli.md), [mcp](mcp.md) or [engine](engine.md) directly.

## Surface

- `effected` and `effected-mcp` bins, each a shim calling its front end's `main()` with `distribution: { name: "@effected/plugin", version }`, so `effected --version` ends with `via @effected/plugin <version>`.
- `PLUGIN_VERSION`, replaced at build. Nothing else: no logic belongs here.

## Boundaries

- **Shared bins.** The front ends declare the same bin names so each installs alone and the agent plugin's one-off fallback can run `@effected/mcp`; the packed-install e2e sets `allowSharedBins` and proves the shims with `runCarrierBin` ([the pattern](../decisions/carrier-only-declares-bins.md)).
- **Hoist.** [pnpm-plugin-effected](pnpm-plugin-effected.md) sets `publicHoistPattern: ["@effected/plugin"]`. The packed-install e2e showed it matters only when a leaf workspace package declares the carrier; a root devDependency's bin already resolves.
- **Closure.** It is installed at the root, so its dependency closure must install with no peer warnings beside kit libraries ([peer discipline](../conventions/peer-dependency-discipline.md)).
