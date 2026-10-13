---
type: Convention
title: No @effected/* package imports typescript
description: "@effected/* packages never import the typescript package, at runtime or as import type; version-coupled TypeScript knowledge is owned by tsconfig-json as data tables, and direct TS-API usage stays confined to external consumers until a TypeScript 7.1 JS-compatible API exists."
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - compat
  - architecture
sources:
  - id: tsconfig-json-enum-codec
    resource: ../../packages/tsconfig-json/src/TsEnumCodec.ts
  - id: package-manifests
    resource: ../../packages/tsconfig-json/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 25d4881fadbc4ba8
---

# No @effected/* package imports typescript

No package under `packages/*` imports the `typescript` package, at
runtime or as an `import type` — `typescript` appears only as a
`devDependency` pinned to `catalog:build`, used solely to run each
package's own `tsc --noEmit` typecheck step, never as code a published
package executes or re-exports.[^package-manifests]

`@effected/tsconfig-json` is the package that would most plausibly need
a live TypeScript API — it reads, resolves and constructs
`tsconfig.json` files — and it holds the line anyway. Its
version-coupled knowledge of TypeScript's enum-valued compiler options
(`target`, `module`, `moduleResolution`, `jsx`, and their string/numeric
alias tables) is owned as plain data rather than as calls into a real
compiler: `TsEnumCodec.ts` transcribes each family's alias-to-canonical
mapping verbatim as maps and does lossless numeric↔string data movement
only, with zero `typescript` imports including type-only
ones.[^tsconfig-json-enum-codec] A schema upstream (`CompilerOptions.ts`)
validates a value before it ever reaches this codec, so the codec itself
never has to ask a real compiler what a valid `lib` entry or `target`
looks like.

Direct TypeScript-API usage is confined to **external consumers**, never
to a kit package. `rspress-plugin-api-extractor` carries `typescript@6`
directly for Twoslash type-checking, as the sanctioned island, until a
TypeScript 7.1 JS-compatible API exists — TypeScript 7 (the Go rewrite)
ships a `tsc` binary but no JS-compatible API before that release, and
its timing is unresolved. The kit's own workspace still typechecks under
TypeScript 7 via `catalog:build`, which does not conflict with this
convention: `catalog:build` supplies each package's own build-time
`tsc --noEmit` step, not a runtime dependency any published package
carries.

The rule holds at the package-set level, not merely behind an optional
peer: an earlier predecessor package that kept a live TypeScript
dependency behind optional peers (`ts-vfs`) is no longer part of the kit
at all — it lives in the external `type-registry-effect` repository,
consumed from source by `rspress-plugin-api-extractor`, specifically
because keeping it out of the kit preserves this posture rather than
merely softening it with an optional dependency.

Never add `typescript` as a `dependency` or `peerDependency` of any
`@effected/*` package, and never add an `import type` from `typescript`
inside `packages/*/src`. When a package genuinely needs TypeScript-shaped
knowledge — an enum mapping, a config shape — encode it as data the way
`tsconfig-json` does, verified against an installed `typescript` version
at design time rather than read from it at run time.

[^tsconfig-json-enum-codec]: `packages/tsconfig-json/src/TsEnumCodec.ts:1-13`
    — "Zero `typescript` imports, including `import type`… No Schema:
    this module does no validation, only lossless numeric↔string data
    movement for values a schema already validated upstream."
[^package-manifests]: `packages/tsconfig-json/package.json:42` —
    `"typescript": "catalog:build"` under `devDependencies`, never under
    `dependencies` or `peerDependencies`, the shape every other package
    in `packages/*` repeats.
