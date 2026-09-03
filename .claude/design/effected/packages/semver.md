---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - package-json.md
---

# @effected/semver design

## Overview

`@effected/semver` is strict SemVer 2.0.0 as Effect Schema classes: parse, compare, range matching, range algebra and a cache service, all pure. It is the repo's DX north star — when an API shape is in question elsewhere in the kit, this package is the precedent.

## Tier and dependencies

Pure tier — no IO anywhere. `effect` is the only peer; there are no cross-`@effected` edges, and the dependency direction is one-way: downstream packages depend on semver, never the reverse. `"sideEffects": false`.

## Module layout

Module-per-concept per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept). One module per domain concept — `SemVer`, `Comparator`, `Range`, `VersionDiff`, `VersionCache` — each owning its own tagged errors rather than kind-based `errors/` and `schemas/` folders. `src/index.ts` is the only re-exporting module; see it for the full export list.

`src/internal/` holds the parsing pipeline: `grammar.ts` (recursive descent), `desugar.ts` (caret/tilde/x-range/hyphen), `normalize.ts` (comparator sort plus build-ignoring dedupe) and `order.ts`. `order.ts` exists to break a cycle: both `SemVer` and `Range` need the spec's compare primitives, so they live once in a module neither imports from the other.

## API posture

Class-based throughout. Instance methods are the canonical form, cross-cutting operations are `Fn.dual` statics on the owning class, and there are no floating functions. Construct via `.make()` (or the positional `SemVer.of`), never `new`, so validation runs.

The class *is* the schema. `SemVer`, `Comparator` and `Range` are plain `Schema.Class` — no `_tag`, because the serialized form is the canonical string via each class's `FromString` transformation. `VersionDiff` is the one `Schema.TaggedClass`, the single concept where serialized tag discrimination earns its keep.

Two constraints on `SemVer`'s field checks are load-bearing:

- Prerelease string identifiers must carry at least one non-digit, so all-numeric identifiers decode as numbers and `FromString` round-trips stay canonical.
- The identifier pattern is written **lookahead-free**, because fast-check's `stringMatching` cannot synthesize lookahead. This is what makes `Schema.toArbitrary(SemVer)` — and therefore the `it.effect.prop` round-trip tests — work at all.

There is deliberately **no `SemVer.diff`**: `VersionDiff`'s fields reference `SemVer`, so a delegating static would create an import cycle and `noImportCycles` is error-level. `VersionDiff.between(a, b)` is the single canonical diff entry point.

Grouping (`groupBy`, `latestByMajor`, `latestByMinor`) lives on `SemVer` as pure statics rather than on `VersionCache` — grouping needs no state, and putting it on the service would make a pure operation require a layer.

## Result is the primitive

The synchronous `Result` form holds the engine and the `Effect` form derives from it: each `parseResult` (and `Range.intersectResult`) runs the grammar, and its `Effect` twin is `Effect.fromResult(...)` behind the existing span. The two cannot drift, and synchronous callers never pay for a runtime. This is the kit convention — see [formatter-convention.md](../formatter-convention.md), decision 6.

The comparison statics are deliberately out of scope: already plain, total and dual, so a `Result` twin would be dead surface.

## String-level validity

String validity is a **lexically paired surface**: the `isValid` boolean pairs with the `ExactVersionString` `Schema.String` check, and `isPinnable` with `PinnableVersionString`. Each schema check is refined by its same-stem predicate, so the two levels cannot drift and the pairing is discoverable by name.

All four **reject surrounding whitespace**, deliberately diverging from `parseResult`, which trims to match node-semver's constructor. The parser canonicalizes; the predicates answer "is this string, byte for byte, a version?" Padded input is the caller's bug to surface, not this package's to hide.

"Pinnable" additionally excludes build metadata. This encodes the corepack `<name>@<version>[+<integrity>]` pin notion, where the first `+` after the version always begins the integrity component — a version carrying build identifiers would encode to a string that re-parses differently. `PinnableVersionString` is consumed **by identity** in [`@effected/package-json`](package-json.md)'s `PackageManager`; downstream must never re-derive it.

## Schema transformations

Each `FromString` is a `Schema.decodeTo` transformation from `Schema.String` to the domain class: decode runs the internal pipeline (grammar → desugar → normalize for ranges), encode is `toString`. One source of truth yields round-tripping and `Schema.toArbitrary` derivation for property tests.

Domain errors carry structured `input`/`position` payloads and derive `message` from a getter — never a preformatted string — so a serialized error stays reconstructible. The `FromString` transformations fail with `SchemaIssue.InvalidValue` instead; `SchemaError` never escapes the package.

`Range.intersect` carries a typed failure rather than returning an unsatisfiable range, so an impossible constraint set is a failure the caller must handle rather than a value that silently matches nothing. `Range.isSubset` (and therefore `equivalent` and `simplify`) is a conservative approximation — false negatives are expected and safe; read the in-source remark before "fixing" it.

## VersionCache

A `Context.Service` over a `Ref<ReadonlyArray<SemVer>>` kept sorted and deduplicated by SemVer precedence via binary search; membership and dedupe ignore build metadata. `VersionCache.layer` is bound once with `Layer.effect` (`Ref` construction is effectful) and requires nothing.

The absence semantics are the design decision worth knowing: the service layers *two distinct kinds of absence*. "Nothing is cached" and "the pivot version is not cached" are typed failures; "the pivot sits at the boundary" and "no version matched" are `Option` and `[]` respectively. A caller that conflates them will mishandle an empty cache.

## Equal and Hash semantics

`SemVer` customizes structural equality to ignore build metadata (SemVer §10) while including prerelease identifiers (§11). This is load-bearing — `VersionCache` dedupe and `Equal.equals` both inherit spec semantics from it.

Because `Equal.equals` fast-paths on hash mismatch, the class overrides **both** `[Equal.symbol]` and `[Hash.symbol]`. Overriding equality alone silently fails.

## Observability

Named `Effect.fn` spans on the effectful, failure-carrying public boundaries only — the `parse` statics, `Range.intersect` and every fallible `VersionCache` method. Pure synchronous comparisons, bumps and matching are not instrumented, and internal grammar helpers get no spans. The library is telemetry-agnostic; no OTel configuration lives here.

## Testing

`@effect/vitest` with `it.effect` as the default mode, in `packages/semver/__test__/`. Three things there are structural rather than incidental:

- `VersionCache` suites use one top-level `layer(VersionCache.layer)((it) => {...})` group, so the layer is built once and memoized instead of provided per test.
- Round-trip properties run through `it.effect.prop` with `Schema.toArbitrary(SemVer)` — the payoff for the lookahead-free identifier pattern.
- A node-semver-compatible spec-compliance fixture suite is the safety net for any grammar change.

## Build

Class factories are written inline (`export class X extends Schema.Class<X>("X")({...}) {}`), which synthesizes `_base` heritage symbols api-extractor cannot resolve. `savvy.build.ts` suppresses them **narrowly** (`ae-forgotten-export` scoped to the `_base` pattern), keeping `dist/prod/issues.json` zero-warning via the `suppressed` bucket. Never widen it — sibling packages depend on this precedent staying narrow. Policy: [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories).
