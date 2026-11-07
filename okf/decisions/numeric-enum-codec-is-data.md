---
type: Decision
title: The numeric-enum codec is data, not a typescript dependency
description: TypeScript's enum numeric values live in tsconfig-json as a hand-transcribed data table rather than being imported from the typescript package.
status: stable
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T22:28:49Z
integrity:
  generated:
    body: f6d324411ac6d441
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 4edbe0714f78f90e
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The numeric-enum codec is data, not a typescript dependency

## Context

TypeScript's compiler options use string spellings in `tsconfig.json` (`"target": "es2023"`) but numeric enum values in its programmatic API (`ts.ScriptTarget.ES2023`). A consumer bridging between a decoded tsconfig document and a live TypeScript compiler API — a virtual-TS environment, for instance — needs a mapping between the two. The obvious way to get that mapping is to import `typescript` and read its enums directly.

## Decision

`@effected/tsconfig-json` owns the string↔numeric mappings for every TypeScript enum family as a **plain data module** (`TsEnumCodec.ts`), including the enum-value gaps that not all TypeScript versions export, transcribed by hand from TypeScript's own source rather than imported from the `typescript` package at runtime or at the type level.

## Alternatives rejected

**Importing `typescript` to read its enums directly** was rejected outright: it would violate the rule keeping `typescript` imports inside the bundler, which this package exists partly to enforce (see [typescript stays in the bundler](../conventions/typescript-stays-in-the-bundler.md)), and it would make the whole package's install cost jump by however large `typescript` itself is, for consumers who otherwise need nothing from it. **Depending on `typescript` as a type-only import** was also rejected — the rule covers type imports too, in every package but the bundler, precisely so a structural or type-only dependency cannot quietly reappear as a build-time coupling to a specific TypeScript version.

## Consequences

Every enum family — `target`, `module`, `moduleResolution`, `jsx`, `newLine`, `moduleDetection`, and the rest — has its own hand-maintained table, verified against a specific installed TypeScript version at the time it was written (verification recorded as source comments citing the exact `typescript.js` line and version checked). When TypeScript adds a new enum member in a later release, updating this package is a **data edit and a test fixture**, never a dependency bump — the table's freshness is decoupled from whichever TypeScript version happens to be installed anywhere in a consumer's tree. The trade is that a table can lag a very recent TypeScript release until someone updates it by hand; the decode direction is deliberately passthrough-honest about this (an unmapped numeric value is left as-is rather than erroring), so a lagging table degrades gracefully rather than rejecting valid input outright. See [the enum mapping tables](../models/tsconfig-enum-mappings.md) for what an entry holds and how the table is refreshed.
