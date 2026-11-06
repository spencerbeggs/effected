---
type: Convention
title: No @effected/* package imports or peers typescript, except @effected/bundler
description: "Only @effected/bundler imports or peers the typescript package, peering it from catalog:build:peers because rolldown-plugin-dts' tsgo generator resolves it by import.meta.resolve; every other package keeps typescript-shaped knowledge as data, and API Extractor keeps its own TypeScript 6."
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
  at: 2026-11-06T15:28:18Z
integrity:
  generated:
    body: 7728b0ae3f744e43
---

# No @effected/* package imports or peers typescript, except @effected/bundler

Never import `typescript` from `packages/*/src`, at runtime or as `import type`, and never add it as a `dependency` or `peerDependency` of an `@effected/*` package. `@effected/bundler` is the one exception.

## The exception

[`@effected/bundler`](../modules/bundler.md) peers `typescript` from `catalog:build:peers`, because `rolldown-plugin-dts`' tsgo generator resolves it by `import.meta.resolve("typescript")`, so the compiler has to be reachable from the bundler's own position in the graph.[^plan] It also reads the compiler API from TypeScript 7.1's `typescript/sync` and `typescript/ast` subpaths. The root `typescript` export carries only version strings.[^spec]

Do not widen the exception. A package that wants compiler behaviour takes it through the bundler or states the need as a new Decision.

## API Extractor stays on its own compiler

API Extractor keeps its bundled TypeScript 6. Never pass it `typescriptCompilerFolder`. It reaches into internals TypeScript 7 does not expose, so the two-compiler arrangement stays, and a declaration TypeScript 7 emits has to remain parseable by TypeScript 6.[^spec]

## Everyone else

- `typescript` stays a `devDependency` from `catalog:build`, used to run the package's own `tsc --noEmit`. That does not change.
- When a package needs TypeScript-shaped knowledge, such as an enum mapping or a config shape, encode it as data verified against an installed `typescript` at design time. [`@effected/tsconfig-json`](../modules/tsconfig-json.md) is the model and stays data-only: `TsEnumCodec.ts` has zero `typescript` imports, including type-only ones.[^tsconfig-json-enum-codec]
- Other direct TypeScript-API use stays in external consumers. `rspress-plugin-api-extractor` and `type-registry-effect` carry their own.

This replaces [the earlier blanket rule](no-typescript-imports.md), whose premise was "until a TypeScript 7.1 JS-compatible API exists". That API now exists, and a pipeline that emits declarations cannot avoid it.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 2, 3 and 5.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
[^tsconfig-json-enum-codec]: `packages/tsconfig-json/src/TsEnumCodec.ts`.
