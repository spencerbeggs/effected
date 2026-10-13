---
type: DataModel
title: tsconfig-json enum mapping tables
description: The hand-transcribed string-to-numeric-value tables TsEnumCodec derives every TypeScript enum-family conversion from.
status: stable
resource: ../../packages/tsconfig-json/src/TsEnumCodec.ts
tags:
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 236e5812d5dcaaab
---

# tsconfig-json enum mapping tables

## What an entry holds

`TsEnumCodec.ts` holds one table per TypeScript compiler-option enum family — `target`, `module`, `moduleResolution`, `jsx`, `newLine`, `moduleDetection`, and the remaining families the module's `EnumFamily` type enumerates. Each table is transcribed verbatim from TypeScript's own source in TypeScript's own row order: a string spelling maps to the numeric enum value TypeScript's compiler API uses for it, with an alias row (`es6`) immediately preceding the canonical spelling it collapses to (`es2015`, `node` before `node10`). The reverse numeric→canonical-string map is built by iterating each family's rows in that same order and always overwriting on a duplicate numeric value, so the **last** row listed for a given numeric value wins as canonical — one rule that reproduces every alias/canonical pairing with no per-family special-casing.

A `lib` normalizer sits alongside the enum tables specifically, because `lib` references have three legitimate spellings (short name, file-name form, and the form `@typescript/vfs`'s own heuristic tolerates) that a plain enum table does not capture.

## What derives from it

`TsEnumCodec.encodeCompilerOptions` (string → numeric, feeding an external virtual-TS environment) and `TsEnumCodec.decodeCompilerOptions` (numeric → string, absorbing configs coming out of a live TypeScript API) both read these tables and nothing else — no `typescript` import backs either direction. `CompilerOptionsFromProgrammatic`, the validating "door in" codec, composes `decodeCompilerOptions`'s normalization with the schema's own decode, so a case-mismatched or numeric-spelled input passed by a caller writing TypeScript directly (`ts.ScriptTarget.ES2025`) still resolves through these same tables before validation. `PortableTsconfig`'s allow-list filter and `JsxConfig`'s projection both consume the string-level schema these tables ultimately feed, one step removed.

## What breaks if an entry is wrong

A wrong or stale numeric value in a table produces a **silent misencoding**: `encodeCompilerOptions` would hand a virtual-TS environment or a live compiler a numeric value that does not mean what the corresponding string spelling means, and because the encode direction returns a structurally-typed value rather than a schema-validated one, nothing downstream would catch the mismatch — the compiler would simply behave as if the wrong option had been set. A missing entry is safer than a wrong one: the decode direction is deliberately passthrough-honest, so a numeric value the table does not cover is left as-is rather than errored, meaning an out-of-date table degrades to "some values aren't normalized" rather than "some values are normalized incorrectly." The `lib` file-name-form requirement is the one entry verified against a live compiler run rather than source reading alone (`Program` construction genuinely fails to resolve the short form), so getting that one wrong produces an observable compiler error rather than a silent semantic drift.

## How it is refreshed

When TypeScript adds a new enum member in a later release, the table is refreshed by hand: read the new value out of the installed TypeScript's own source (the compiler's `.d.ts` or transpiled `.js`, at the line the existing table's citations already point to for that family), add the row in the position that keeps the alias-before-canonical ordering rule intact, and add a test fixture pinning the new value. This is a data edit and a test fixture, never a dependency bump on `typescript` itself — see [the numeric-enum codec is data, not a typescript dependency](../decisions/numeric-enum-codec-is-data.md) for why that property is load-bearing rather than incidental.
