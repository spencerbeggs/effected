---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
---

# @effected/semver design

## Overview

`@effected/semver` is strict SemVer 2.0.0 as Effect Schema classes: parse, compare, range matching, range algebra and a cache service, all pure. Class-based DX is the north star — instance methods are the canonical form, cross-cutting operations are dual statics on the owning class, and there are no floating functions.

## Tier and dependencies

Pure tier — no IO anywhere. `peerDependencies`: `effect` only. No cross-`@effected` edges; downstream packages depend on semver, never the reverse. `"sideEffects": false`.

## Module layout

Module-per-concept per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `src/index.ts` — public surface, re-exports only.
- `src/SemVer.ts` — the `SemVer` domain class (`Schema.Class`), `SemVer.FromString`, all version statics and instance methods including the `bump` namespace and the pure grouping statics (`groupBy`, `latestByMajor`, `latestByMinor`); owns `InvalidVersionError`.
- `src/Comparator.ts` — `Comparator` class, `Comparator.FromString`, `parse`, instance `test`; owns `InvalidComparatorError`.
- `src/Range.ts` — `Range` class plus the `ComparatorSet` type, `Range.FromString`, `parse`, matching and algebra statics, instance `test`/`filter`; owns `InvalidRangeError` and `UnsatisfiableConstraintError`.
- `src/VersionDiff.ts` — `VersionDiff` (`Schema.TaggedClass`) with static `between`.
- `src/VersionCache.ts` — the `VersionCache` service plus `VersionCache.layer`; owns `EmptyCacheError`, `VersionNotFoundError`, `UnsatisfiedRangeError`.
- `src/internal/grammar.ts` — the recursive-descent parser, plain synchronous code returning `ParseResult` values.
- `src/internal/desugar.ts` — caret/tilde/x-range/hyphen desugaring.
- `src/internal/normalize.ts` — comparator sort plus semantic dedupe (build-ignoring).
- `src/internal/order.ts` — the shared compare primitives, so spec ordering rules live once and the `SemVer`↔`Range` cycle stays broken.

Every non-entrypoint module imports explicitly from its defining module; no barrels beyond `index.ts`.

## Public API

Class-based throughout: instance methods are the canonical form, cross-cutting operations are dual statics on the owning class.

### SemVer

Plain `Schema.Class` — no `_tag`, because the serialized form is the version string via `FromString`. Fields: `major`/`minor`/`patch` as non-negative safe integers, `prerelease` as an array of string-or-number identifiers, `build` as an array of strings. Construct via `SemVer.make(...)` so validation runs. Field checks are `Schema.is*` combinators (`Schema.isInt()`, `Schema.isBetween(...)`, `Schema.isPattern(regex)`). Prerelease string identifiers require at least one non-digit — all-numeric identifiers decode as numbers — keeping `FromString` round-trips canonical. The identifier pattern is written **lookahead-free** because fast-check's `stringMatching` cannot synthesize lookahead, which is what makes `Schema.toArbitrary` + `it.effect.prop` work.

- Schema exports: the class and `SemVer.FromString`.
- Statics: `parse`; `Order` and `OrderWithBuild` (`Order.Order<SemVer>` consts); dual statics `compare`, `gt`, `gte`, `lt`, `lte`, `equal`, `neq`, `truncate`; array helpers `sort`, `rsort`, `max`, `min` (`Option` for absence); pure grouping statics `groupBy` (immutable record return), `latestByMajor`, `latestByMinor`.
- Instance: `compare`/`gt`/`gte`/`lt`/`lte`/`equal`/`neq`, getters `isStable` and `isPrerelease`, the fluent `bump` namespace (`v.bump.major()`, `minor`, `patch`, `prerelease(id?)`, `release`, with node-semver-compatible prerelease semantics) and `toString` as the encode direction.

There is **no `SemVer.diff`**: a delegating static would create a `SemVer`↔`VersionDiff` import cycle (`VersionDiff` fields reference `SemVer`, and `noImportCycles` is error-level), so `VersionDiff.between(a, b)` is the single canonical diff entry point.

### Comparator

Plain `Schema.Class`. Fields: `operator` literal (`=`, `>`, `>=`, `<`, `<=`) and `version: SemVer`. Statics `parse`, `FromString`; instance `test(version)`, `toString`.

### Range

Plain `Schema.Class` holding `sets` (an array of comparator sets; the `ComparatorSet` type is exported). Statics `parse`, `FromString`; dual matching statics `satisfies`, `filter`, `maxSatisfying`, `minSatisfying` (`Option` for absence); algebra statics `union`, `intersect`, `isSubset`, `equivalent`, `simplify`. `intersect` carries a typed failure (`UnsatisfiableConstraintError`) rather than returning an unsatisfiable range. `isSubset` is documented as a conservative approximation. Instance `test(version)`, `filter(versions)`, `toString`.

### VersionDiff

`Schema.TaggedClass` — the one concept where serialized tag discrimination earns its keep. Fields: `type` literal, `from`/`to` SemVers, `major`/`minor`/`patch` deltas. Static `between(a, b)` is the single canonical diff entry point. Instance `toString`.

### VersionCache

A `Context.Service` class with `VersionCache.layer` bound once (`Layer.effect` — `Ref` construction is effectful; the layer requires nothing). State is a `Ref<ReadonlyArray<SemVer>>` kept sorted and deduplicated by SemVer precedence via binary search; membership and dedupe ignore build metadata. Interface:

- Mutation: `load`, `add`, `remove`.
- Query: `versions()`, `latest()`, `oldest()` — all thunks. `latest`/`oldest` fail `EmptyCacheError`; `versions()` never fails and returns a possibly-empty array.
- `filter(range)` never fails — empty cache and no-matches both return `[]`.
- Resolution: `resolve(range)` fails `UnsatisfiedRangeError`; `resolveString(input)` fails `InvalidRangeError | UnsatisfiedRangeError`.
- Navigation: `diff(a, b)`, `next(version)`, `prev(version)` fail `VersionNotFoundError` when the pivot is not cached; `next`/`prev` additionally return `Option` for "pivot at the boundary." The error-plus-`Option` layering is two distinct absences and is documented on the interface.

Grouping (`groupBy`/`latestByMajor`/`latestByMinor`) lives on `SemVer` as pure statics, not on the service.

## Schema transformation strategy

`SemVer.FromString`, `Range.FromString` and `Comparator.FromString` are decode/encode transformations from `Schema.String` to the domain class via `Schema.decodeTo`. Decode runs the internal grammar (grammar → desugar → normalize for ranges); encode is `toString`. One source of truth yields round-tripping and `Schema.toArbitrary` derivation for property tests.

The `parse` statics call the grammar directly and construct domain errors with exact `input`/`position`; the `FromString` transformations use the same grammar and fail with `SchemaIssue.InvalidValue` carrying a message. `SchemaError` never escapes the package.

## Error set

Each error is a single `Schema.TaggedErrorClass` in its concept's module, with payload fields referencing the schema classes directly (so `UnsatisfiedRangeError` is fully serializable) and `message` derived via getter from structured fields — never preformatted strings.

| Error | Raised by | Payload |
| --- | --- | --- |
| `InvalidVersionError` | `SemVer.parse` / `SemVer.FromString` decode | `input`, `position?` |
| `InvalidRangeError` | `Range.parse` / `Range.FromString` decode; `VersionCache.resolveString` | `input`, `position?` |
| `InvalidComparatorError` | `Comparator.parse` / `Comparator.FromString` decode | `input`, `position?` |
| `UnsatisfiableConstraintError` | `Range.intersect` (empty cross-product) | `constraints: ReadonlyArray<Range>` |
| `UnsatisfiedRangeError` | `VersionCache.resolve` / `resolveString` | `range: Range`, `available: ReadonlyArray<SemVer>` |
| `VersionNotFoundError` | `VersionCache.diff` / `next` / `prev` | `version: SemVer` |
| `EmptyCacheError` | `VersionCache.latest` / `oldest` | none |

## Equal and Hash semantics

`SemVer` customizes structural equality: it ignores build metadata (SemVer spec §10) while including prerelease identifiers (§11). This is load-bearing — cache dedupe and `Equal.equals` both inherit spec semantics from it. Because `Equal.equals` fast-paths on hash mismatch, the class overrides **both** `[Equal.symbol]` and `[Hash.symbol]`; overriding equality alone silently fails. Regression tests pin build-ignoring equality and hash agreement.

## Observability

Named `Effect.fn` spans on the effectful, failure-carrying public boundaries only: `SemVer.parse`, `Range.parse`, `Comparator.parse`, `Range.intersect` and every fallible `VersionCache` boundary (`resolve`, `resolveString`, `diff`, `next`, `prev`, `latest`, `oldest`). Pure synchronous comparisons, bumps and matching are not instrumented; internal grammar helpers get no spans. The library is telemetry-agnostic — no OTel configuration anywhere.

## Testing

`@effect/vitest` with `it.effect` as the default mode; `assert.*`, never `expect`. Tests live in `packages/semver/__test__/`.

- `VersionCache` suites use top-level `layer(VersionCache.layer)((it) => {...})` groups — built once, memoized, no per-test `Effect.provide`.
- Parse/print round-trip properties via `it.effect.prop` with `Schema.toArbitrary(SemVer)`: `decode(encode(v))` round-trips and generated versions satisfy the field constraints. Derivation works because the field checks are lookahead-free.
- A node-semver-compatible spec-compliance fixture suite is the redesign's safety net.
- Regression tests pin build-ignoring equality and prerelease bump semantics (identifier switch resets the counter, `1.0.0` → `1.0.1-0`).

## Build

Class factories are written inline (`export class X extends Schema.Class<X>("X")({...}) {}`) with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern), keeping `dist/prod/issues.json` zero-warning via the `suppressed` bucket. This tracks the ratified policy in [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories).
