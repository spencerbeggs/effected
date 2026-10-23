---
type: Decision
title: "@effected/semver stays independent of core SemVer and SemVerRange"
description: "The kit keeps its own grammar, classes and range algebra rather than building on or wrapping core's unstable effect/SemVer and effect/SemVerRange, and uses core as a differential test oracle instead."
status: draft
tags:
  - architecture
  - dx
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-23T20:50:04Z
sources:
  - id: issue-1040
    resource: https://github.com/spencerbeggs/effected/issues/1040
  - id: core-semver
    resource: ../../.repos/effect/packages/effect/src/SemVer.ts
  - id: core-semverrange
    resource: ../../.repos/effect/packages/effect/src/SemVerRange.ts
  - id: core-parity-test
    resource: ../../packages/semver/__test__/core-parity.test.ts
integrity:
  generated:
    body: aa20ff1aa174facc
---

# @effected/semver stays independent of core SemVer and SemVerRange

## Context

Effect added `effect/SemVer` and `effect/SemVerRange` to core, both tagged
`@stability unstable`, overlapping [semver](../modules/semver.md)[^issue-1040].
Eight kit packages depend on semver, and `package-json`, `npm` and
`lockfiles` embed its `Schema.Class` values in their own public schemas. A
three-way parity probe (kit, core, node-semver) agreed on version parsing
and on every ordering pair, and found that every range disagreement was a
kit bug core already got right; those bugs were fixed in the same wave.

## Decision

The kit keeps its own grammar, value classes and range algebra. It neither
re-implements its classes over core values nor ships `fromCore`/`toCore`
converters. Core is used as a free oracle instead: a differential test runs
every version parse, ordering and range match through both and fails on any
disagreement outside a named allowlist[^core-parity-test].

## Rationale

- Core's modules can break in a minor release[^core-semver]. Building on
  them would tie a pure package and its eight dependents to that churn.
- Core has no range algebra (`intersect`, `isSubset`, `equivalent`,
  `simplify`)[^core-semverrange] and no position-bearing errors; its
  `SemVerError` carries a message and the input, but no
  position[^core-semver].
- Core deliberately separates a structural `Equivalence` that includes
  build metadata from a precedence `Order` that ignores it. The kit's
  `Equal` follows precedence, and `VersionCache` dedupe depends on that, so
  wrapping core values would change equality semantics underneath it.
- Core prints ranges syntax-preserving (`^1.2.3`); the kit prints the
  desugared, normalized form (`>=1.2.3 <2.0.0-0`) that its algebra and its
  `FromString` round-trips are built on.

## Deliberate divergences

The differential test allowlists exactly three, by name:

| Divergence | Kit | Core |
| --- | --- | --- |
| Padded version input (`" 1.2.3"`) | trims, as node-semver does | rejects |
| Build metadata in a range or comparator (`1.2.3+build`) | accepts and drops it, as npm does | rejects |
| Equality of `1.0.0+a` and `1.0.0+b` | equal (precedence) | not equivalent (structural) |

Never mix kit and core values in one hash-keyed collection: the two
equalities disagree on build metadata.

The differential test covers parsing, ordering and matching only, not
bumps. One bump divergence is known and unguarded: on a prerelease with
several numeric identifiers, the kit's `bump.prerelease` increments the
last one while core's `bumpPrerelease` increments the right-most numeric
one, so `1.0.0-1.beta` bumps to `1.0.0-1.beta.0` in the kit and
`1.0.0-2.beta` in core. Aligning it, and adding a bump block to the
differential test, is a follow-up.

## Consequences

- A core change that moves a version or range answer turns the differential
  test red on the next Effect advance, before a consumer sees it.
- Code with no kit edge may use core directly for a throwaway compare or
  bump. Anything that crosses a kit API, needs a `FromString` codec, range
  algebra, `VersionCache` or a position-bearing error uses this package.
- Revisit converters only if a consumer asks and core drops `unstable`.

[^issue-1040]: <https://github.com/spencerbeggs/effected/issues/1040>
[^core-semver]: `.repos/effect/packages/effect/src/SemVer.ts`
[^core-semverrange]: `.repos/effect/packages/effect/src/SemVerRange.ts`
[^core-parity-test]: `packages/semver/__test__/core-parity.test.ts`
