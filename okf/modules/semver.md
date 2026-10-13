---
type: Module
title: semver
description: Strict SemVer 2.0.0 versions, ranges and comparators as Effect Schema classes — the kit's DX exemplar.
status: stable
kind: package
resource: ../../packages/semver
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: f3b1091e81939728
---

# semver

## Purpose

`@effected/semver` implements strict SemVer 2.0.0 — parsing, comparison, range matching, range algebra, and a version cache — entirely as Effect Schema classes. It is the repository's DX north star: when another package's API shape is in question, this package is the precedent to copy.

## Tier and dependency posture

[Pure tier](../glossary/library-tier.md): `effect` is the only peer, no IO anywhere, `"sideEffects": false`, and no cross-`@effected` edges. The dependency direction is one-way — downstream packages depend on semver, never the reverse.

## Module layout

Module-per-concept: one file per domain concept (`SemVer.ts`, `Comparator.ts`, `Range.ts`, `VersionDiff.ts`, `VersionCache.ts`), each owning its own tagged errors rather than kind-based `errors/`/`schemas/` folders. `src/index.ts` is the only re-exporting module. `src/internal/` holds the parsing pipeline: `grammar.ts` (recursive descent), `desugar.ts` (caret/tilde/x-range/hyphen), `normalize.ts` (comparator sort and build-metadata-ignoring dedupe), and `order.ts` — a module that exists solely to break a cycle, since both `SemVer` and `Range` need the spec's compare primitives and neither may import the other.

## Public surface

Class-based throughout: instance methods are the canonical form, cross-cutting operations are `Fn.dual` statics on the owning class, and there are no floating functions. Construct via `.make()` (or the positional `SemVer.of`), never `new`, so validation runs.

The class *is* the schema: `SemVer`, `Comparator` and `Range` are plain `Schema.Class` with no `_tag`, because each has a canonical string form via its own `FromString` transformation; `VersionDiff` is the one `Schema.TaggedClass`, the single concept where serialized tag discrimination earns its keep.

String-level validity is a lexically paired surface: `SemVer.isValid` (boolean) pairs with the `ExactVersionString` `Schema.String` check, and `isPinnable` pairs with `PinnableVersionString`; each schema check is refined by its same-stem predicate so the two cannot drift and the pairing is discoverable by name. All four **reject surrounding whitespace**, deliberately diverging from `parseResult`, which trims to match node-semver's constructor — the parser canonicalizes, the predicates answer "is this string, byte for byte, a version?", and padded input is the caller's bug to surface, not this package's to hide. "Pinnable" additionally excludes build metadata, encoding the corepack `<name>@<version>[+<integrity>]` pin notion (the first `+` after the version always begins the integrity component); `PinnableVersionString` is consumed **by identity** in `package-json`'s `PackageManager`, and downstream must never re-derive it.

There is deliberately **no `SemVer.diff`**: `VersionDiff`'s fields reference `SemVer`, so a delegating static on `SemVer` would create an import cycle, and `noImportCycles` is error-level. `VersionDiff.between(a, b)` is the single canonical diff entry point. Grouping (`groupBy`, `latestByMajor`, `latestByMinor`) lives on `SemVer` as pure statics rather than on `VersionCache`, since grouping needs no state and putting it on the service would force a pure operation to require a layer.

`VersionCache` is a `Context.Service` over a `Ref<ReadonlyArray<SemVer>>` kept sorted and deduplicated by SemVer precedence via binary search, with membership and dedupe ignoring build metadata; `VersionCache.layer` is bound once with `Layer.effect` (`Ref` construction is effectful) and requires nothing. Its absence semantics are the load-bearing design decision: "nothing is cached" and "the pivot version is not cached" are typed failures, while "the pivot sits at the boundary" and "no version matched" are `Option` and `[]` respectively — a caller that conflates the two mishandles an empty cache.

## Result is the primitive

The synchronous `Result` form holds the engine and the `Effect` form derives from it: `SemVer.parseResult`, `Range.parseResult`, `Comparator.parseResult` and `Range.intersectResult` run the grammar, and each `Effect` twin is `Effect.fromResult(...)` behind the existing span, so the two cannot drift and synchronous callers never pay for a runtime. This is the kit-wide [sync primitive policy](../conventions/sync-primitive-policy.md); see [semver's Result-is-the-primitive decision](../decisions/semver-result-is-the-primitive.md) for why the comparison statics are deliberately out of scope for a `Result` twin.

## Schema transformations

Each `FromString` is a `Schema.decodeTo` transformation from `Schema.String` to the domain class: decode runs the internal pipeline (grammar → desugar → normalize for ranges), encode is `toString`. One source of truth yields both round-tripping and `Schema.toArbitrary` derivation for property tests. Two constraints on `SemVer`'s field checks are load-bearing: prerelease string identifiers must carry at least one non-digit, so all-numeric identifiers decode as numbers and `FromString` round-trips stay canonical; and the identifier pattern is written **lookahead-free**, because the native `Arbitrary` regex compiler rejects lookahead, which is what makes `Arbitrary.schema(SemVer)` — and therefore the `it.effect.prop` round-trip tests — work at all.

## Errors

Domain errors carry structured `input`/`position` payloads and derive `message` from a getter — never a preformatted string — so a serialized error stays reconstructible. The `FromString` transformations fail with `SchemaIssue.InvalidValue` instead; `SchemaError` never escapes the package. `Range.intersect` carries a typed failure rather than returning an unsatisfiable range, so an impossible constraint set is a failure the caller must handle rather than a value that silently matches nothing. `Range.isSubset` (and therefore `equivalent` and `simplify`) is a conservative approximation — false negatives are expected and safe.

## Equal and Hash semantics

`SemVer` customizes structural equality to ignore build metadata (SemVer §10) while including prerelease identifiers (§11); `VersionCache` dedupe and `Equal.equals` both inherit this. Because `Equal.equals` fast-paths on hash mismatch, the class overrides **both** `[Equal.symbol]` and `[Hash.symbol]` — overriding equality alone silently fails.

## Observability

Named `Effect.fn` spans on the effectful, failure-carrying public boundaries only — the `parse` statics, `Range.intersect`, and every fallible `VersionCache` method. Pure synchronous comparisons, bumps and matching are not instrumented, and internal grammar helpers get no spans. The library is telemetry-agnostic.

## Testing

`@effect/vitest` with `it.effect` as the default mode, tests in `packages/semver/__test__/`. `VersionCache` suites use one top-level `layer(VersionCache.layer)((it) => {...})` group so the layer is built once and memoized rather than provided per test. Round-trip properties run through `it.effect.prop` with `Schema.toArbitrary(SemVer)`, the payoff for the lookahead-free identifier pattern. A node-semver-compatible spec-compliance fixture suite is the safety net for any grammar change.

## Build

Class factories are written inline (`export class X extends Schema.Class<X>("X")({...}) {}`), which synthesizes `_base` heritage symbols API Extractor cannot resolve; `savvy.build.ts` suppresses them narrowly (`ae-forgotten-export` scoped to the `_base` pattern), keeping `dist/prod/issues.json` zero-warning via the `suppressed` bucket. Never widen this suppression — sibling packages depend on this precedent staying narrow.
