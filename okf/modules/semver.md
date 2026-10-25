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
  by: "claude-code/opus-5.5"
  at: 2026-10-25T14:19:57Z
integrity:
  generated:
    body: d40ed05a46304739
---

# semver

## Purpose

`@effected/semver` implements strict SemVer 2.0.0 — parsing, comparison, range matching, range algebra, and a version cache — entirely as Effect Schema classes. It is the repository's DX north star: when another package's API shape is in question, this package is the precedent to copy.

## Tier and dependency posture

[Pure tier](../glossary/library-tier.md): `effect` is the only peer, no IO anywhere, `"sideEffects": false`, and no cross-`@effected` edges. The dependency direction is one-way — downstream packages depend on semver, never the reverse.

## Module layout

Module-per-concept: one file per domain concept (`SemVer.ts`, `Comparator.ts`, `Range.ts`, `VersionDiff.ts`, `VersionCache.ts`), each owning its own tagged errors rather than kind-based `errors/`/`schemas/` folders. `src/index.ts` is the only re-exporting module. `src/internal/` holds the parsing pipeline: `grammar.ts` (recursive descent), `desugar.ts` (caret/tilde/x-range/hyphen), `normalize.ts` (comparator sort and build-metadata-ignoring dedupe), and `order.ts` — a module that exists solely to break a cycle, since both `SemVer` and `Range` need the spec's compare primitives and neither may import the other.

## Public surface

Class-based throughout: instance methods are the canonical form, operations with no instance counterpart are `Fn.dual` statics on the owning class, and there are no floating functions. No static shares a name with an instance member: API Extractor cannot resolve a `{@link}` to either declaration of such a pair, so the redundant comparison statics (`compare`, `gt`, `gte`, `lt`, `lte`, `equal`, `neq`) and `Range.filter` were dropped in favour of the instance methods, with data-last comparisons derived from `SemVer.Order` via core `Order.isGreaterThan` and friends. Construct via `.make()` (or the positional `SemVer.of`), never `new`, so validation runs.

The class *is* the schema: `SemVer`, `Comparator` and `Range` are plain `Schema.Class` with no `_tag`, because each has a canonical string form via its own `FromString` transformation; `VersionDiff` is the one `Schema.TaggedClass`, the single concept where serialized tag discrimination earns its keep.

String-level validity is a lexically paired surface: `SemVer.isValid` (boolean) pairs with the `ExactVersionString` `Schema.String` check, and `isPinnable` pairs with `PinnableVersionString`; each schema check is refined by its same-stem predicate so the two cannot drift and the pairing is discoverable by name. All four **reject surrounding whitespace**, deliberately diverging from `parseResult`, which trims to match node-semver's constructor — the parser canonicalizes, the predicates answer "is this string, byte for byte, a version?", and padded input is the caller's bug to surface, not this package's to hide. "Pinnable" additionally excludes build metadata, encoding the corepack `<name>@<version>[+<integrity>]` pin notion (the first `+` after the version always begins the integrity component); `PinnableVersionString` is consumed **by identity** in `package-json`'s `PackageManager`, and downstream must never re-derive it.

There is deliberately **no `SemVer.diff`**: `VersionDiff`'s fields reference `SemVer`, so a delegating static on `SemVer` would create an import cycle, and `noImportCycles` is error-level. `VersionDiff.between(a, b)` is the single canonical diff entry point. Grouping (`groupBy`, `latestByMajor`, `latestByMinor`) lives on `SemVer` as pure statics rather than on `VersionCache`, since grouping needs no state and putting it on the service would force a pure operation to require a layer.

`VersionCache` is a `Context.Service` over a `Ref<ReadonlyArray<SemVer>>` kept sorted and deduplicated by SemVer precedence via binary search, with membership and dedupe ignoring build metadata; `VersionCache.layer` is bound once with `Layer.effect` (`Ref` construction is effectful) and requires nothing. Its absence semantics are the load-bearing design decision: "nothing is cached" and "the pivot version is not cached" are typed failures, while "the pivot sits at the boundary" and "no version matched" are `Option` and `[]` respectively — a caller that conflates the two mishandles an empty cache. Its lookups take a `Range` and match the way that range was parsed to; `resolveString(input, options?)` forwards `RangeOptions` to the parse.

## Prerelease matching

`Range.test` applies node-semver's default rule: a prerelease version satisfies a comparator set only when some comparator in it carries a prerelease on the same `major.minor.patch`, so `^1.2.3` never matches `1.2.4-alpha`. `includePrerelease` lifts that rule, and it is a **parse** option — `Range.parse(input, { includePrerelease: true })`, `Range.parseResult` and `VersionCache.resolveString` take a `RangeOptions` bag — because node-semver and core apply it while desugaring, not only while matching: a wildcard floor is lowered to its first prerelease (`^1.2` → `>=1.2.0-0 <2.0.0-0`, `*` → `>=0.0.0-0`, `1.2.3 - 2` → `>=1.2.3-0 <3.0.0-0`) while a literal full floor keeps its release form (`>=1.2.0` stays `>=1.2.0` and still rejects `1.2.0-alpha`). The kit stores desugared comparators, so that distinction is gone after parsing; a match-time flag could only drop the tuple rule and would disagree with core on every partial floor.

The parsed `Range` therefore records the choice in an `includePrerelease` schema field (constructor and decoding default `false`, so `Range.make({ sets })` and a serialized `{ sets }` keep meaning the default rule), and every matcher — `test`, `filter`, `satisfies`, `maxSatisfying`, `minSatisfying`, the `VersionCache` lookups — reads it from the value rather than taking the option again. Two ranges with the same sets but different flags are not `Equal`, a prerelease-including range is never `isSubset` of a default one, and `union`, `intersect` and `simplify` carry `self`'s flag. The one lossy path is `Range.FromString`: the string form has no syntax for the flag, so decoding always yields the default rule and only the struct form round-trips it.

## Result is the primitive

The synchronous `Result` form holds the engine and the `Effect` form derives from it: `SemVer.parseResult`, `Range.parseResult`, `Comparator.parseResult` and `Range.intersectResult` run the grammar, and each `Effect` twin is `Effect.fromResult(...)` behind the existing span, so the two cannot drift and synchronous callers never pay for a runtime. This is the kit-wide [sync primitive policy](../conventions/sync-primitive-policy.md); see [semver's Result-is-the-primitive decision](../decisions/semver-result-is-the-primitive.md) for why the comparison statics are deliberately out of scope for a `Result` twin.

## Schema transformations

Each `FromString` is a `Schema.decodeTo` transformation from `Schema.String` to the domain class: decode runs the internal pipeline (grammar → desugar → normalize for ranges), encode is `toString`. One source of truth yields both round-tripping and `Schema.toArbitrary` derivation for property tests. Two constraints on `SemVer`'s field checks are load-bearing: prerelease string identifiers must carry at least one non-digit, so all-numeric identifiers decode as numbers and `FromString` round-trips stay canonical; and the identifier pattern is written **lookahead-free**, because the native `Arbitrary` regex compiler rejects lookahead, which is what makes `Arbitrary.schema(SemVer)` — and therefore the `it.effect.prop` round-trip tests — work at all.

## Errors

Domain errors carry structured `input`/`position` payloads (core's `SemVerError` carries a message and the input, but no position) and derive `message` from a getter — never a preformatted string — so a serialized error stays reconstructible. The `FromString` transformations fail with `SchemaIssue.InvalidValue` instead; `SchemaError` never escapes the package. `Range.intersect` carries a typed failure rather than returning an unsatisfiable range, so an impossible constraint set is a failure the caller must handle rather than a value that silently matches nothing. `Range.isSubset` (and therefore `equivalent` and `simplify`) is a conservative approximation — false negatives are expected and safe.

## Equal and Hash semantics

`SemVer` customizes structural equality to ignore build metadata (SemVer §10) while including prerelease identifiers (§11); `VersionCache` dedupe and `Equal.equals` both inherit this. Because `Equal.equals` fast-paths on hash mismatch, the class overrides **both** `[Equal.symbol]` and `[Hash.symbol]` — overriding equality alone silently fails.

## Relation to core

Core ships `effect/SemVer` and `effect/SemVerRange`, both `@stability unstable`. This package stays independent of them and uses them as a test oracle instead: `__test__/core-parity.test.ts` runs every version parse, ordering, range match (under both prerelease rules) and prerelease bump through both and fails on any disagreement outside four named divergences — padded version input (the kit trims), build metadata in a range or comparator (the kit drops it, core rejects it), equality with build metadata (the kit's `Equal` follows precedence; core deliberately keeps a structural `Equivalence` that includes build beside a precedence `Order` that ignores it, so never mix the two in a hash-keyed collection), and release bumps of a prerelease (`bump.major()` on `2.0.0-beta.1` increments to `3.0.0`; core finishes the release at `2.0.0`). Why, and when to reach for core instead: [stays independent of core SemVer](../decisions/semver-stays-independent-of-core-semver.md).

The range grammar matches node-semver and core at the edges: any `\s` whitespace separates comparators and may follow an operator (`>= 18`); `^*`, `~*` and `^x` match every release while `>*` and `<*` desugar to the unsatisfiable `<0.0.0-0`, which the range algebra treats as empty; a `*` side of a hyphen range drops that side's comparator; and a concrete component may not follow a wildcard (`1.*.3`). `SemVerBump.prerelease` matches core `SemVer.bumpPrerelease` on every input: it reads an all-digit identifier as numeric, increments the **right-most numeric** identifier wherever it sits (`1.0.0-1.beta` → `1.0.0-2.beta`), appends `0` only when there is none, and throws on a malformed identifier. node-semver's `inc` differs from both on one quirk — an identifier equal to the first one resets to `[id, 0]` when the second identifier is not numeric — which the pinned fixtures leave out by name.

## Observability

Named `Effect.fn` spans on the effectful, failure-carrying public boundaries only — the `parse` statics, `Range.intersect`, and every fallible `VersionCache` method. Pure synchronous comparisons, bumps and matching are not instrumented, and internal grammar helpers get no spans. The library is telemetry-agnostic.

## Testing

`@effect/vitest` with `it.effect` as the default mode, tests in `packages/semver/__test__/`. `VersionCache` suites use one top-level `layer(VersionCache.layer)((it) => {...})` group so the layer is built once and memoized rather than provided per test. Round-trip properties run through `it.effect.prop` with `Schema.toArbitrary(SemVer)`, the payoff for the lookahead-free identifier pattern. A node-semver-compatible spec-compliance fixture suite — including tables pinned from node-semver 7.8.5 for `includePrerelease` matching and prerelease bumps — is the safety net for any grammar or bump change, and the core-parity differential test is the early warning for a core change.

## Build

Class factories are written inline (`export class X extends Schema.Class<X>("X")({...}) {}`), which synthesizes `_base` heritage symbols API Extractor cannot resolve; `savvy.build.ts` suppresses them narrowly (`ae-forgotten-export` scoped to the `_base` pattern), keeping `dist/prod/issues.json` zero-warning via the `suppressed` bucket. Never widen this suppression — sibling packages depend on this precedent staying narrow.
