---
type: Convention
title: Only @effected/bundler imports typescript, and only it and the tool's packages peer it
description: "Only @effected/bundler imports the typescript package. It and the tool's cli, mcp and plugin peer it at one literal range that excludes nightlies: rolldown-plugin-dts' tsgo generator resolves it by import.meta.resolve, and npm's resolver needs the peer at the installed package. Every other package keeps typescript-shaped knowledge as data, and API Extractor keeps its own TypeScript 6."
status: draft
stale_after: "2027-05-06T00:00:00Z"
supersedes: ../conventions/no-typescript-imports.md
tags:
  - compat
  - architecture
  - deps
sources:
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: plan
    resource: ../../docs/superpowers/plans/2026-11-06-bundler-branch.md
    title: "Decisions this plan takes, item 6"
  - id: tsconfig-json-enum-codec
    resource: ../../packages/tsconfig-json/src/TsEnumCodec.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-09T00:05:23Z
integrity:
  generated:
    body: 3a9de05702f9cfc8
---

# Only @effected/bundler imports typescript, and only it and the tool's packages peer it

Outside `@effected/bundler`, never import `typescript` from `packages/*/src`, at runtime or as `import type`. Never add it as a `dependency` of any `@effected/*` package, or as a `peerDependency` of one other than the bundler and the tool's `cli`, `mcp` and `plugin`, which peer it for the bundler's sake and import nothing from it.

## The exception

[`@effected/bundler`](../modules/bundler.md) peers `typescript` because `rolldown-plugin-dts`' tsgo generator resolves it by `import.meta.resolve("typescript")`, so the compiler has to be reachable from the bundler's own position in the graph.[^plan] It also reads the compiler API from TypeScript 7.1's `typescript/sync` and `typescript/ast` subpaths. The root `typescript` export carries only version strings.[^spec]

The range is the literal `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, not `catalog:effected:build:peers`, because that catalog value pins a prerelease exactly and a plain lower bound would admit `-dev` nightlies. [`@effected/plugin`](../modules/plugin.md), [`@effected/cli`](../modules/cli.md) and [`@effected/mcp`](../modules/mcp.md) declare the same literal, so a consumer's install surfaces the peer: with none at the installed package, npm's resolver never finishes on the prerelease that `tsdown`'s optional range does not admit. The plugin's `entry.test.ts` holds the four manifests to one string.

Do not widen the exception. A package that wants compiler behaviour takes it through the bundler or states the need as a new Decision.

## API Extractor stays on its own compiler

API Extractor keeps its bundled TypeScript 6. Never pass it `typescriptCompilerFolder`. It reaches into internals TypeScript 7 does not expose, so the two-compiler arrangement stays, and a declaration TypeScript 7 emits has to remain parseable by TypeScript 6.[^spec]

## Everyone else

- `typescript` stays a `devDependency` from `catalog:effected:build`, used to run the package's own `tsc --noEmit`. That does not change.
- When a package needs TypeScript-shaped knowledge, such as an enum mapping or a config shape, encode it as data verified against an installed `typescript` at design time. [`@effected/tsconfig-json`](../modules/tsconfig-json.md) is the model and stays data-only: `TsEnumCodec.ts` has zero `typescript` imports, including type-only ones.[^tsconfig-json-enum-codec]
- Other direct TypeScript-API use stays in external consumers. `rspress-plugin-api-extractor` and `type-registry-effect` carry their own.

This replaces [the earlier blanket rule](no-typescript-imports.md), whose premise was "until a TypeScript 7.1 JS-compatible API exists". That API now exists, and a pipeline that emits declarations cannot avoid it.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 2, 3 and 5.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
[^tsconfig-json-enum-codec]: `packages/tsconfig-json/src/TsEnumCodec.ts`.
