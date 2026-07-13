---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
---

# @effected/semver design

## Overview

Target design for `@effected/semver`, the first package migration (step 2 of [migration-playbook.md](../migration-playbook.md)). Source is semver-effect (`/Users/spencer/workspaces/spencerbeggs/semver-effect`, Effect v3); the step-1 analysis lives in `.claude/reviews/semver.md` and this design implements its §3 v4-mapping and §4 layout decisions against [effect-standards.md](../effect-standards.md). This is a redesign, not a lift-and-shift: the class-based DX survives, the kind-based folder layout, static-wiring hack, floating-function layer and dead surface do not. Status: **merged**; this doc records the as-built design, with deviations from the approved draft noted inline.

## Tier and dependencies

Pure tier — no IO anywhere. `peerDependencies`: `effect` only (`catalog:effect`). `devDependencies`: `effect` and `@effect/vitest` (both `catalog:effect`). No cross-@effected edges; runtimes and package-json will later depend on this package, not the reverse. `"sideEffects": false` (the v3 `"sideEffects": ["**/index.js"]` existed only for the index.ts static-wiring hack, which does not survive). Target directory is `packages/semver` (placeholder exists).

## Module layout (module-per-concept)

Per the module-per-concept standard, ~10 files replacing the v3 repo's 32:

- `src/index.ts` — public surface, re-exports only, zero side effects.
- `src/SemVer.ts` — `SemVer` domain class (`Schema.Class`), `SemVer.FromString` schema, all version statics and instance methods including the `bump` namespace, the grouping statics absorbed from the cache (`groupBy`, `latestByMajor`, `latestByMinor`); owns `InvalidVersionError`.
- `src/Comparator.ts` — `Comparator` class, `Comparator.FromString`, `parse`, instance `test`; owns `InvalidComparatorError`.
- `src/Range.ts` — `Range` class plus `ComparatorSet` type, `Range.FromString`, `parse`, matching and algebra statics, instance `test`/`filter`; owns `InvalidRangeError` and `UnsatisfiableConstraintError`.
- `src/VersionDiff.ts` — `VersionDiff` tagged class (`Schema.TaggedClass` — serialized discrimination is wanted here) with static `between`; raises nothing.
- `src/VersionCache.ts` — `Context.Service` class plus its `VersionCache.layer` static (`Layer.effect` over a `Ref` — see the VersionCache section for the SortedSet replacement); owns `EmptyCacheError`, `VersionNotFoundError`, `UnsatisfiedRangeError`.
- `src/internal/grammar.ts` — recursive-descent parser, ported as plain synchronous code (sanctioned by review §3): the v3 `FailFn<E>` parameterization dissolved; entry points return plain ParseResult values and each concept constructs its own domain error.
- `src/internal/desugar.ts` — caret/tilde/x-range/hyphen desugaring.
- `src/internal/normalize.ts` — comparator sort plus semantic dedupe (build-ignoring).
- `src/internal/order.ts` — shared compare primitives; breaks the SemVer↔order cycle that forced v3 to inline `comparePre` in `SemVer.ts` and duplicate `satisfiesSet` in `Range.ts` — spec rules live once.

Every non-entrypoint module imports explicitly from defining modules; no barrels, no re-export facades. `VersionCache` is flagged (review §5) as the future subpath-entry candidate (`@effected/semver/VersionCache`) if a schema-only dependency profile is ever wanted — no split now.

## Target public API

Class-based DX throughout: instance methods are the canonical form, cross-cutting operations are dual statics on the owning class, and there are no floating functions. The v3 triple surface (instance + static + floating dual function) collapses to the first two.

### SemVer

Plain `Schema.Class` (no `_tag` — the serialized form is the version string via `FromString`). Fields: `major`/`minor`/`patch` as non-negative safe integers, `prerelease` as array of string-or-number identifiers, `build` as array of strings. Construction via `SemVer.make(...)` so validation actually runs — the v3 `new SemVer({...})` internal habit bypassed even the weak checks. As-built check API: v4 checks are `Schema.is*` combinators (`Schema.isInt()`, `Schema.isBetween({minimum, maximum})`, `Schema.isPattern(regex)`). Prerelease string identifiers additionally require at least one non-digit — all-numeric identifiers are numbers — keeping `FromString` round-trips canonical (one type-level value per encoded string); the pattern is written lookahead-free because fast-check's `stringMatching` cannot synthesize lookahead, which is what makes `Schema.toArbitrary` + `it.effect.prop` work.

- Schema exports: the class itself and `SemVer.FromString`.
- Statics: `parse`; `Order` and `OrderWithBuild` (`Order.Order<SemVer>` consts, replacing `SemVerOrder`/`SemVerOrderWithBuild`); dual statics `compare`, `gt`, `gte`, `lt`, `lte`, `equal`, `neq`, `truncate`; array helpers `sort`, `rsort`, `max`, `min` (`Option` for absence); pure grouping statics over `ReadonlyArray<SemVer>` moved off the cache service: `groupBy` (immutable record return), `latestByMajor`, `latestByMinor`.
- As-built deviation: `SemVer.diff` was NOT ported. The delegating static would create a SemVer↔VersionDiff import cycle (`VersionDiff` fields reference `SemVer`; `noImportCycles` is error-level), so `VersionDiff.between(a, b)` is the single canonical diff entry point. `VersionCache.diff` still exists on the service.
- Instance: `compare`/`gt`/`gte`/`lt`/`lte`/`equal`/`neq`, getters `isStable` and `isPrerelease`, the fluent `bump` namespace (kept deliberately — `v.bump.major()`, `minor`, `patch`, `prerelease(id?)`, `release`, with node-semver-compatible prerelease semantics preserved) and `toString` as the encode direction.
- Dropped from the class: the `eq` alias (use `equal`), custom `toJSON` (schema encoding owns serialization), the mutable `_bump` memo field (the accessor becomes mutation-free).

### Comparator

Plain `Schema.Class` (v3's `_tag` dropped — no serialized discrimination need). Fields: `operator` literal (`=`, `>`, `>=`, `<`, `<=`) and `version: SemVer`. Statics: `parse`, `FromString`. Instance: `test(version)`, `toString`.

### Range

Plain `Schema.Class` holding `sets` (array of comparator sets; `ComparatorSet` type export kept). Statics: `parse`, `FromString`; dual matching statics `satisfies`, `filter`, `maxSatisfying`, `minSatisfying` (`Option` for absence); algebra statics `union`, `intersect`, `isSubset`, `equivalent`, `simplify` — the v3 `utils/algebra.ts` module dissolves into the class, and `intersect` keeps its honest typed failure (`UnsatisfiableConstraintError`) instead of returning an unsatisfiable range. The documented conservative-approximation caveat on `isSubset` is carried over verbatim — that documentation habit is house style. Instance: `test(version)`, `filter(versions)`, `toString`.

### VersionDiff

`Schema.TaggedClass` (the one concept where serialized tag discrimination earns its keep). Fields as in v3: `type` literal, `from`/`to` SemVers, `major`/`minor`/`patch` deltas. Static `between(a, b)` — the single canonical diff entry point (`SemVer.diff` was not ported; see the SemVer deviation note above). Instance `toString`.

### VersionCache

`Context.Service` class — identifier and shape in one place (v3's `Context.Tag` does not exist in v4). The layer is a static (`VersionCache.layer`) bound once (`Layer.effect` — Ref construction is effectful); the v3 layer's `SemVerParser` dependency disappears because `resolveString` calls `Range.parse` directly, so the layer requires nothing. As-built implementation note: v4 removed `SortedSet`, so the state is a `Ref<ReadonlyArray<SemVer>>` kept sorted and deduplicated by SemVer precedence (binary search; membership and dedupe ignore build metadata, matching the v3 SortedSet-with-SemVerOrder semantics).

Slimmed interface (v3's surface minus the grouping trio, with the review-§2 inconsistencies resolved):

- Mutation: `load`, `add`, `remove`.
- Query: `versions()`, `latest()`, `oldest()` — all thunks, resolving the v3 getter-vs-thunk mix. `latest`/`oldest` fail `EmptyCacheError` (asking for an extremum of nothing is a real failure); `versions()` never fails and returns a possibly-empty array.
- `filter(range)` never fails: empty cache and no-matches both return `[]`, resolving the v3 inconsistency where an empty cache raised `EmptyCacheError` but a non-empty cache with no matches returned `[]` — one representation of "nothing" per operation.
- Resolution: `resolve(range)` fails `UnsatisfiedRangeError`; `resolveString(input)` fails `InvalidRangeError | UnsatisfiedRangeError`.
- Navigation: `diff(a, b)`, `next(version)`, `prev(version)` fail `VersionNotFoundError` when the pivot version is not cached; `next`/`prev` additionally return `Option` for "pivot is at the boundary". The error-plus-Option layering is deliberate (two different absences) and gets documented on the interface.
- `groupBy`/`latestByMajor`/`latestByMinor` leave the service — they are pure derivations over the version array and become `SemVer` statics (see above), also fixing the mutable `Map` return.

## Schema transformation strategy

`SemVer.FromString`, `Range.FromString` and `Comparator.FromString` are decode/encode transformations from `Schema.String` to the domain class via `Schema.decodeTo`, with the decode direction driven by the internal grammar (grammar → desugar → normalize pipeline for ranges) and the encode direction being `toString`. One source of truth yields parse/print round-tripping and `Schema.toArbitrary` derivation for property tests for free, replacing v3's hand-wired `parseValidSemVer`-assigned-onto-the-class statics and custom `toJSON`.

Payload fidelity, resolved as-built: the `parse` statics call the internal grammar directly and construct domain errors with exact `input`/`position`; the `FromString` transformations use the same grammar and fail with `SchemaIssue.InvalidValue` carrying a message. `SchemaError` never escapes the package and no re-extraction hack was needed.

## Error set (derived from raise sites)

Enumerated from actual construction sites in the v3 source (grep of `src/`, 2026-07-06), not from the v3 export list. Each error is a single `Schema.TaggedErrorClass` in its concept's module file, payload fields referencing the schema classes directly (making `UnsatisfiedRangeError` fully serializable), `message` derived via getter from structured fields — never preformatted strings.

| Error | Raised by | Payload |
| --- | --- | --- |
| `InvalidVersionError` | `SemVer.parse` / `SemVer.FromString` decode (grammar version entry points) | `input: string`, `position?: number` |
| `InvalidRangeError` | `Range.parse` / `Range.FromString` decode; `VersionCache.resolveString` | `input: string`, `position?: number` |
| `InvalidComparatorError` | `Comparator.parse` / `Comparator.FromString` decode | `input: string`, `position?: number` |
| `UnsatisfiableConstraintError` | `Range.intersect` (empty cross-product) | `constraints: ReadonlyArray<Range>` |
| `UnsatisfiedRangeError` | `VersionCache.resolve` / `resolveString` (cache non-empty, nothing matches) | `range: Range`, `available: ReadonlyArray<SemVer>` |
| `VersionNotFoundError` | `VersionCache.diff` / `next` / `prev` (pivot not cached) | `version: SemVer` |
| `EmptyCacheError` | `VersionCache.latest` / `oldest` on an empty cache | none |

Dead errors verified and not ported: `InvalidBumpError` and `InvalidPrereleaseError` are exported and documented in v3 but a grep across `src/` finds no construction site for either — their only non-definition reference is the `index.ts` export line. `VersionFetchError` is constructed nowhere either (it exists only as the declared error type of the unimplemented `VersionFetcher` port) and drops with it.

## Equal and Hash semantics

The custom `[Equal.symbol]`/`[Hash.symbol]` implementation survives: structural equality ignores build metadata (SemVer spec §10) while including prerelease identifiers (§11). This is load-bearing — cache dedupe and `Equal.equals` both inherit spec semantics from it. Hook resolved as-built: v4 `Schema.Class` equality customization means overriding BOTH `[Equal.symbol]` and `[Hash.symbol]` in the class body — `Equal.equals` fast-paths on hash mismatch, so overriding `Equal.symbol` alone silently fails. Regression tests pin build-ignoring equality and hash agreement.

## Observability plan

v3 has zero instrumentation. Per the observability standard, `Effect.fn("name")` at public operation boundaries only — the effectful, failure-carrying operations: `SemVer.parse`, `Range.parse`, `Comparator.parse`, `Range.intersect` and every fallible `VersionCache` boundary (`resolve`, `resolveString`, `diff`, `next`, `prev`). Pure synchronous comparisons, bumps and matching are not instrumented; internal grammar helpers get no spans. The library stays telemetry-agnostic — no OTel configuration anywhere.

As-built (v4 best-practice review, `7d1704d`): `VersionCache.diff`/`next`/`prev` were converted from anonymous `Effect.gen` to named `Effect.fn` spans, so every public fallible boundary of the service is instrumented uniformly rather than only `resolve`/`resolveString`. The same review removed unreachable `operator === ""` branches in `internal/desugar.ts`'s x-range desugaring (dead since the grammar never emits an empty operator).

As-built (realignment, 2026-07-08): `VersionCache.latest`/`oldest` (the two remaining fallible boundaries, failing `EmptyCacheError`) also gained named `Effect.fn` spans, so span coverage is now uniform across the entire fallible service surface with no anonymous-`gen` gaps.

## Deliberately not ported

- `VersionFetcher` service and `VersionFetchError` — a boundary IO port inside a pure-tier package, one method, no implementation shipped. Consumers define their own port; revisit only when a real registry client package exists (review §5).
- `SemVerParser` service and `SemVerParserLive` — pure-function indirection over the grammar; parsing is a static on the class in a pure-tier package.
- Dead errors `InvalidBumpError` and `InvalidPrereleaseError` (verification above).
- `prettyPrint` and the `Printable` union — a dispatcher over four types that all already have `toString`.
- All floating util functions (`utils/compare.ts`, `bump.ts`, `matching.ts`, `algebra.ts`, `parseRange.ts` exports plus `parseValidSemVer`/`parseSingleComparator`) — absorbed as instance methods and dual statics.
- All ten *public* `*ErrorBase` export pairs — v3's doubled public surface stays banned. Assumption corrected as-built: the extractor ceremony does not die with `Schema.TaggedErrorClass` — an inline factory heritage clause is `ae-forgotten-export` (CI-fatal). Ratified policy as-built (2026-07-07, commit 5f854fb): named, exported, `@public`-tagged `X_base` consts with explicit factory-return-type annotations, re-exported from `index.ts`, plus the schema helper consts their annotations reference (`nonNegativeInteger`, `prereleaseIdentifier`, `buildIdentifier` in `src/SemVer.ts`) tagged `@public` too — anything referenced by a `@public` signature must itself be `@public` under silk's binary release-tag policy. This yields a zero-warning `dist/prod/issues.json` (the earlier `@internal`-with-residual-`ae-incompatible-release-tags`-warnings idiom is superseded). The extra public surface is the accepted cost, distinguished from the banned v3 `*ErrorBase` ceremony by not-for-direct-use doc comments on every base and helper. Idiom: `plugin/skills/effect-api-extractor-bases/SKILL.md`.

  As-built (realignment, 2026-07-08): the transitional `@public X_base` idiom above is superseded. All the class factories are now written **inline** (`export class X extends Schema.Class<X>("X")({...}) {}`) with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern); no `*_base` const is exported and the `issues.json` stays zero-warning via the `suppressed` bucket. The `nonNegativeInteger`/`prereleaseIdentifier`/`buildIdentifier` helper consts inline into the base too and no longer need `@public`. This tracks the ratified policy in [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories).
- The `eq` alias for `equal`.
- The index.ts static-wiring block and the `*.module.test.ts` suite that existed only to verify it; `"sideEffects"` declaration becomes `false`.
- From `VersionCache`: the grouping trio (`groupBy`, `latestByMajor`, `latestByMinor`) as service methods — pure statics on `SemVer` instead; the `versions` property getter (thunk now); `filter`'s `EmptyCacheError` (never fails now, `[]` uniformly); the mutable `Map` return from `groupBy`.

## Testing strategy

`@effect/vitest` with `it.effect` as the default mode; never plain `it()` + `runPromise` (the v3 suites are all plain vitest and convert wholesale). Tests live in `packages/semver/__test__/` (unit `*.test.ts`) per repo convention.

- `VersionCache` suites use top-level `layer(VersionCache.layer)((it) => {...})` groups — built once, memoized, no per-test `Effect.provide`.
- Parse/print round-trip properties via `it.effect.prop` with `Schema.toArbitrary(SemVer)`: decode(encode(v)) round-trips and generated versions satisfy the field constraints. Derivation works because the field checks are lookahead-free `Schema.is*` combinators (see the SemVer field notes above).
- Port the v3 spec-compliance fixture suite (node-semver-compatible cases) — it converts directly and is the safety net for the redesign.
- Regression tests pinning build-ignoring equality and prerelease bump semantics (identifier switch resets counter, `1.0.0` → `1.0.1-0`).

All of the draft's verify-during-implementation items are resolved; their resolutions are recorded inline in the sections above (Equal/Hash hook, check API shape, payload fidelity, API Extractor bases, arbitrary derivation).
