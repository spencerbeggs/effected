---
type: Decision
title: jsonc's engine/facade split is a cycle firewall
description: The vendored scanner/parser in internal/ returns raw records and never imports the facade, which is what keeps noImportCycles satisfiable.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 15253645f3fd4166
---

# jsonc's engine/facade split is a cycle firewall

## Context

`@effected/jsonc` vendors a scanner/parser engine (ported with attribution to Microsoft's `jsonc-parser` design) under `src/internal/`, and exposes an Effect-native facade (`Jsonc.ts`, `JsoncNode.ts`, `JsoncEdit.ts`, `JsoncFormatter.ts`, `JsoncModifier.ts`, `JsoncVisitor.ts`) built on top of it. `noImportCycles` is enforced at error level across the whole repository, so any design where the engine and the facade needed to import each other's types would fail the lint outright, not merely draw a style objection.

## Decision

The engine speaks only in raw records — `{ code, offset, length }` for parse errors, `_tag`-discriminated results for navigation — and never imports a facade module. The facade layer alone materializes those raw records into `Schema.Class` types and `Schema.TaggedError` instances, deriving each detail's `line`/`character` from its `offset` against the source text (offsets are the engine's single positional currency; the scanner tracks no line or column of its own). The one permitted edge in the whole engine is `internal/parser.ts` → `JsoncNode.ts`, which is why the recursion depth cap lives in a separate zero-dependency leaf, `internal/limits.ts`, rather than in `JsoncNode.ts` itself — every recursive surface can import that one constant without closing a cycle back through the node type.

## Alternatives rejected

Letting the engine construct `Schema.Class`/`Schema.TaggedError` instances directly was rejected: the node and error types live in facade modules the engine cannot import without an internal → facade edge, and any facade module that in turn imported engine internals for convenience would close the cycle from the other side. Folding the engine and facade into one module to sidestep the cycle question entirely was also rejected, since it would make the vendored engine's provenance and the hand-written façade indistinguishable in the same file, and would make future engine updates a merge against edited code rather than a drop-in replacement.

## Consequences

An internal module importing a facade module fails the lint immediately, so the boundary is enforced mechanically rather than by review discipline. The cost is a small translation layer: every raw engine record must be walked once more to become a typed domain object, and the depth cap has to live in a dedicated leaf file rather than beside the type it protects. The benefit generalizes to jsonc's siblings — `yaml` and `toml` follow the same firewall shape, so the pattern is a house convention rather than a one-off jsonc accommodation.
