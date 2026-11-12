---
type: Module
title: "@effected/plugin"
description: "The effected tool's carrier: the one package a consumer installs as a root devDependency, declaring the effected and effected-mcp bins as shims that pass its own distribution identity to the CLI and MCP front ends, re-exporting the schemastore config authoring surface, shipping the tsconfig presets as ./tsconfig/*, and publishing a dist that inlines the tool's whole closure and effect."
status: draft
kind: package
resource: ../../packages/plugin
tags:
  - architecture
  - dx
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-12T04:28:39Z
integrity:
  generated:
    body: b73e0328afe6638d
---

# @effected/plugin

`@effected/plugin` is the carrier of the [effected tool](../decisions/one-tool-beside-the-libraries.md), shaped like `@savvy-web/silk`, `@vitest-agent/plugin` and `@okfit/plugin`. A consumer writes `"@effected/plugin": "catalog:effected"` as a root devDependency and receives both bins; nothing recommends installing [cli](cli.md), [mcp](mcp.md) or [engine](engine.md) directly.

## Surface

- `effected` and `effected-mcp` bins, each a shim calling its front end's `main()` with `distribution: { name: "@effected/plugin", version }`, so `effected --version` ends with `via @effected/plugin <version>`.
- The authoring surface of a `schemastore.config.ts` ([the contract](../interfaces/schema-commands.md#the-config-contract)), from the same inlined `@effected/schemastore` the bins run: `defineSchemastore` (its `defineConfig` under the tool's name), `HostedSchema`, `SchemaTarget`, `SchemaVersion`, `SchemaVersioning`, `InvalidSchemaVersionError`, `DriftPolicy`, `KeywordFamilies`, `CatalogEntry`, `CatalogLintFinding`, `SchemastoreVersion`, `SCHEMASTORE_ID_BASE`, `SCHEMASTORE_CATALOG_BASE` and the types they name. A value built from here carries the tool's own version stamp, so [the version check](../decisions/schema-version-mismatch-check.md) always passes for it; a value from a separately installed `@effected/schemastore` passes when that copy is at the same version. The root stays cheap to import from a config: it reaches no front end, no engine, no bundler, no `ajv`, no `jiti` and no Ink, which a built-entry test pins.
- `./tsconfig/*`: the presets a consumer's tsconfig extends, `@effected/plugin/tsconfig/ecma.json`, `action.json` and `root.json`, from `public/tsconfig/`, because the build copies only `public/` into the package. `ecma.json` is for a library or tool package (`nodenext`, incremental, a `dist/.tsbuildinfo.lib`); `action.json` is for a GitHub Action, a drop-in for `@savvy-web/github-action-builder/tsconfig/action.json` (`ESNext`/`bundler`, `noEmit`, no incremental state, so a typecheck writes nothing into the committed `dist/`). `effected action init` scaffolds an `action.json` extends.
- `./env`: a types-only ambient declaration, `@effected/plugin/env`, for `process.env.__PACKAGE_VERSION__` (`readonly __PACKAGE_VERSION__?: string` on `NodeJS.ProcessEnv`). A consumer writes `/// <reference types="@effected/plugin/env" />` where it once referenced the savvy bundler's env types. It lives in `public/env.d.ts`, not `src/`: under `src/` it joins this package's own program, where `ProcessEnv` stops being a pure index signature and `bundler/src/meta/config.ts` fails a weak-type check. A test compiles a consumer under `noPropertyAccessFromIndexSignature` with a control that fails without the reference.
- `PLUGIN_VERSION`, replaced at build. No logic belongs here.

## Boundaries

- **The bundled dist.** `effected.toml` inlines `cli`, `mcp`, `schemastore` and `effect`, and through them every kit package, `@effect/*` and the pure JS beneath them; the emitted manifest drops what was inlined. A consumer's install resolves none of the closure, so no catalog round and no derived `effect` override reaches the tool. What stays an import is what the source manifest still declares: the build toolchain (`tsdown`, `rolldown`, `rolldown-plugin-dts`, `@tsdown/exe`, API Extractor and TSDoc), `jiti`, Ink and React, and the peers `typescript`, `@types/node` and the optional `effect`, `satori` and `@resvg/resvg-js`. `effect` is peered only for the root's declarations, which import its types and inline schemastore's. The build stamps every inlined package with its own version, writes `THIRD_PARTY_LICENSES.txt`, and copies the bundler's Open Graph font into `assets/`.
- **The pin chain.** This package depends on `cli`, `mcp` and `schemastore`; `cli` and `mcp` on `engine`; `engine` on `schemastore` and `bundler`; `schemastore` on `semver`. Every link is `workspace:*`. Here the pins are build-time inputs: they decide which versions the dist holds. Below the carrier, where `cli`, `mcp` and `engine` still publish, they publish exact, so bumping `schemastore` ripples down the chain ([an enumerated `workspace:*` exception](../conventions/peer-dependency-discipline.md#cross-effected-dependencies), and [why the commands live here](../decisions/schema-commands-live-in-the-tool.md)). A test reads the manifests; never loosen a link to `workspace:^`.
- **The `typescript` peer.** This package, [cli](cli.md), [mcp](mcp.md), [engine](engine.md) and [bundler](bundler.md) peer `typescript` at the literal `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, not `catalog:effected:build:peers`, because that catalog value pins a prerelease exactly and a plain lower bound would admit `-dev` nightlies. `entry.test.ts` holds the five manifests to one string. The peer here and on the front ends also keeps npm's resolver from spinning forever on the bundler's peer ([the rule](../conventions/typescript-stays-in-the-bundler.md)).
- **Shared bins.** The front ends declare the same bin names so each installs alone and the agent plugin's one-off fallback can run `@effected/mcp`; the packed-install e2e sets `allowSharedBins` and proves the shims with `runCarrierBin` ([the pattern](../decisions/carrier-only-declares-bins.md)).
- **Hoist.** [pnpm-plugin-effected](pnpm-plugin-effected.md) sets `publicHoistPattern: ["@effected/plugin"]`. The packed-install e2e showed it matters only when a leaf workspace package declares the carrier; a root devDependency's bin already resolves.
- **Closure.** It is installed at the root, so what it still declares must install with no peer warnings beside kit libraries ([peer discipline](../conventions/peer-dependency-discipline.md)).
- **Packed-install e2e.** It packs the carrier alone and proves nothing of the kit or `effect` is installed. A schema consumer with its own `@effected/schemastore` and an `effect` a patch behind the carrier's builds a config with a `HostedSchema` from its own copy, and the output is compared with an expected copy; an `effect` advance that changes output regenerates the copy and the change is reviewed. It also covers the version check's CLI refusal (naming `@effected/plugin` as the remedy), override and MCP warning, and an install of `@effected/mcp` alone.
