---
type: Module
title: "@effected/plugin"
description: "The effected tool's carrier: the one package a consumer installs as a root devDependency, declaring the effected and effected-mcp bins as shims that pass its own distribution identity to the CLI and MCP front ends, re-exporting defineSchemastore for a schemastore config, shipping the tsconfig presets as ./tsconfig/*, and pinning the chain below it exactly."
status: draft
kind: package
resource: ../../packages/plugin
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-08T22:17:30Z
integrity:
  generated:
    body: de10df41c89d2223
---

# @effected/plugin

`@effected/plugin` is the carrier of the [effected tool](../decisions/one-tool-beside-the-libraries.md), shaped like `@savvy-web/silk`, `@vitest-agent/plugin` and `@okfit/plugin`. A consumer writes `"@effected/plugin": "catalog:effected"` as a root devDependency and receives both bins; nothing recommends installing [cli](cli.md), [mcp](mcp.md) or [engine](engine.md) directly.

## Surface

- `effected` and `effected-mcp` bins, each a shim calling its front end's `main()` with `distribution: { name: "@effected/plugin", version }`, so `effected --version` ends with `via @effected/plugin <version>`.
- `defineSchemastore`: `@effected/schemastore`'s `defineConfig` under another name, for a `schemastore.config.ts` ([the contract](../interfaces/schema-commands.md#the-config-contract)). The root stays cheap to import from a config: it reaches no front end, no engine, no `ajv`, no `jiti` and no Ink, which a built-entry test pins.
- `./tsconfig/*`: the presets a consumer's tsconfig extends, `@effected/plugin/tsconfig/ecma.json` and `root.json`, from `public/tsconfig/`, because the build copies only `public/` into the package.
- `./env`: a types-only ambient declaration, `@effected/plugin/env`, for `process.env.__PACKAGE_VERSION__` (`readonly __PACKAGE_VERSION__?: string` on `NodeJS.ProcessEnv`). A consumer writes `/// <reference types="@effected/plugin/env" />` where it once referenced the savvy bundler's env types. It lives in `public/env.d.ts`, not `src/`: under `src/` it joins this package's own program, where `ProcessEnv` stops being a pure index signature and `bundler/src/meta/config.ts` fails a weak-type check. A test compiles a consumer under `noPropertyAccessFromIndexSignature` with a control that fails without the reference.
- `PLUGIN_VERSION`, replaced at build. No logic belongs here.

## Boundaries

- **The pin chain.** This package depends on `cli`, `mcp` and `schemastore`; `cli` and `mcp` on `engine`; `engine` on `schemastore` and `bundler`; `schemastore` on `semver`. Every link is `workspace:*`, publishing exact, so a patch of any of them reaches a consumer only with a new carrier version, and bumping `schemastore` ripples down the chain ([an enumerated `workspace:*` exception](../conventions/peer-dependency-discipline.md#cross-effected-dependencies), and [why the commands live here](../decisions/schema-commands-live-in-the-tool.md)). A test reads the manifests; never loosen a link to `workspace:^`.
- **The `typescript` peer.** This package, [cli](cli.md), [mcp](mcp.md) and [bundler](bundler.md) peer `typescript` at the literal `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, not `catalog:build:peers`, because that catalog value pins a prerelease exactly and a plain lower bound would admit `-dev` nightlies. `entry.test.ts` holds the four manifests to one string. The peer here and on the front ends also keeps npm's resolver from spinning forever on the bundler's peer ([the rule](../conventions/typescript-stays-in-the-bundler.md)).
- **Shared bins.** The front ends declare the same bin names so each installs alone and the agent plugin's one-off fallback can run `@effected/mcp`; the packed-install e2e sets `allowSharedBins` and proves the shims with `runCarrierBin` ([the pattern](../decisions/carrier-only-declares-bins.md)).
- **Hoist.** [pnpm-plugin-effected](pnpm-plugin-effected.md) sets `publicHoistPattern: ["@effected/plugin"]`. The packed-install e2e showed it matters only when a leaf workspace package declares the carrier; a root devDependency's bin already resolves.
- **Closure.** It is installed at the root, so its dependency closure must install with no peer warnings beside kit libraries ([peer discipline](../conventions/peer-dependency-discipline.md)).
- **Packed-install e2e.** It installs the packed tarballs, builds a schema consumer's config with a `HostedSchema` from the consumer's own `@effected/schemastore` and compares the output with an expected copy; an `effect` advance that changes output regenerates the copy and the change is reviewed. It also covers the version check's CLI refusal, override and MCP warning, and an install of `@effected/mcp` alone.
