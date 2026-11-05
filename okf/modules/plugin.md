---
type: Module
title: "@effected/plugin"
description: "The effected tool's carrier: the one package a consumer installs as a root devDependency, declaring the effected and effected-mcp bins as shims that pass its own distribution identity to the CLI and MCP front ends, re-exporting defineSchemastore for a schemastore config, and pinning the chain below it exactly."
status: draft
kind: package
resource: ../../packages/plugin
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: 0756ad582eae31d2
---

# @effected/plugin

`@effected/plugin` is the carrier of the [effected tool](../decisions/one-tool-beside-the-libraries.md), shaped like `@savvy-web/silk`, `@vitest-agent/plugin` and `@okfit/plugin`. A consumer writes `"@effected/plugin": "catalog:effected"` as a root devDependency and receives both bins; nothing recommends installing [cli](cli.md), [mcp](mcp.md) or [engine](engine.md) directly.

## Surface

- `effected` and `effected-mcp` bins, each a shim calling its front end's `main()` with `distribution: { name: "@effected/plugin", version }`, so `effected --version` ends with `via @effected/plugin <version>`.
- `defineSchemastore`: `@effected/schemastore`'s `defineConfig` under another name, for a `schemastore.config.ts` ([the contract](../interfaces/schema-commands.md#the-config-contract)). The root stays cheap to import from a config: it reaches no front end, no engine, no `ajv`, no `jiti` and no Ink, which a built-entry test pins.
- `PLUGIN_VERSION`, replaced at build. No logic belongs here.

## Boundaries

- **The pin chain.** This package depends on `cli`, `mcp` and `schemastore`; `cli` and `mcp` on `engine`; `engine` on `schemastore`; `schemastore` on `semver`. Every link is `workspace:*`, publishing exact, so a patch of any of them reaches a consumer only with a new carrier version, and bumping `schemastore` ripples down the chain ([an enumerated `workspace:*` exception](../conventions/peer-dependency-discipline.md#cross-effected-dependencies), and [why the commands live here](../decisions/schema-commands-live-in-the-tool.md)). A test reads the manifests; never loosen a link to `workspace:^`.
- **Shared bins.** The front ends declare the same bin names so each installs alone and the agent plugin's one-off fallback can run `@effected/mcp`; the packed-install e2e sets `allowSharedBins` and proves the shims with `runCarrierBin` ([the pattern](../decisions/carrier-only-declares-bins.md)).
- **Hoist.** [pnpm-plugin-effected](pnpm-plugin-effected.md) sets `publicHoistPattern: ["@effected/plugin"]`. The packed-install e2e showed it matters only when a leaf workspace package declares the carrier; a root devDependency's bin already resolves.
- **Closure.** It is installed at the root, so its dependency closure must install with no peer warnings beside kit libraries ([peer discipline](../conventions/peer-dependency-discipline.md)).
- **Packed-install e2e.** It installs the packed tarballs, builds a schema consumer's config with a `HostedSchema` from the consumer's own `@effected/schemastore` and compares the output with an expected copy; an `effect` advance that changes output regenerates the copy and the change is reviewed. It also covers the version check's CLI refusal, override and MCP warning, and an install of `@effected/mcp` alone.
