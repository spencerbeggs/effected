---
type: Invariant
title: PackageManager's version and integrity fields ARE the schemas their owning packages export
description: "package-json's PackageManager.fields.version is the same object as @effected/semver's SemVer.PinnableVersionString and fields.integrity.value the same object as @effected/npm's CorepackIntegrityHash; the property is pinned by identity assertions with controls, because a Schema.check is erased from the built .d.ts and a re-derived copy would compile clean and pass every rejection test."
status: stable
resource: ../../packages/package-json/__test__/PackageManager.test.ts
tags:
  - testing
  - architecture
sources:
  - id: package-manager-source
    resource: ../../packages/package-json/src/PackageManager.ts
  - id: package-manager-test
    resource: ../../packages/package-json/__test__/PackageManager.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: f7e7713dc3f2891d
---

# PackageManager's version and integrity fields ARE the schemas their owning packages export

## The property

`PackageManager` models corepack's `<name>@<version>[+<integrity>]`
triple, and both strict halves are consumed from the packages that own
them rather than re-derived:

- `PackageManager.fields.version === SemVer.PinnableVersionString` — the
  version IS `@effected/semver`'s pinnable-version schema (decode rules
  through `SemVer.isPinnable`).
- `PackageManager.fields.integrity.value === CorepackIntegrityHash` —
  the integrity IS `@effected/npm`'s shared corepack `<algo>.<hex>`
  narrowing of `IntegrityHash`.[^package-manager-source]

The version fold is a deliberate strictening of
`PackageManager.FromString`: `pnpm@01.2.3`, `pnpm@1.2.3-01`,
`pnpm@1.2.3-a..b` and the padded `pnpm@ 10.33.0` all fail typed,
matching corepack's own `semver.valid` check minus its trim. The check
sits on the *field*, so `PackageManager.make` refuses a malformed
version — and any build metadata, which the grammar cannot express
because the first `+` after the `@` is spoken for by the integrity —
rather than producing a manifest value that re-parses differently.

## The mechanism

Identity assertions in the consolidation test group, each with a
control that proves the assertion discriminates.[^package-manager-test]
`Schema.Option(X)` keeps `X` on `.value`, so the integrity assertion
reads `fields.integrity.value`; a bare field keeps the schema directly
on `fields`, so the version assertion reads `fields.version`. The
integrity control rejects the unrestricted `IntegrityHash`; the version
controls reject `SemVer.ExactVersionString` and `Schema.String`, the
two neighbours a faithful re-derivation would plausibly reach for. The
version half is additionally pinned behaviourally by an equivalence
test over an untrimmed corpus against `SemVer.parseResult` — whichever
direction a hand-rolled parser drifted, some corpus entry disagrees.

## What a refactor would have to break

Identity is the only guard that can see a severed edge. A
`Schema.check` is erased from the built `.d.ts`, so the public type is
unchanged whether the field is the shared schema or a private copy that
happens to agree with it: severing either edge is not a type error, not
a compile-time-visible break, and passes every rejection test in the
suite. Only `strictEqual` against the owner's export fails. Do not
downgrade either assertion to a source-text check (grepping for the
import), which a re-export shim or an alias defeats, and do not replace
the `.value` read with a fresh `Schema.Option(...)` comparison, which
would be a new object.

The name grammar is deliberately *not* shared: this field model keeps
any lowercase name (manifests as they exist in the wild — corepack
0.34.0 recognizes only npm/pnpm/yarn and would reject the very real
`bun@1.2.20`), while `@effected/npm`'s `PackageManagerPin` closes the
set to the kit's provisioning vocabulary. That divergence is on purpose
and lives in the class's TSDoc; the invariant covers only the two shared
halves.

The integrity edge seen from its owner — `CorepackIntegrityHash` has one
home and two consumers, each pinning identity — is
[CorepackIntegrityHash is consumed by identity](corepack-integrity-hash-shared-by-identity.md).

[^package-manager-source]: `packages/package-json/src/PackageManager.ts`
    — the `version: SemVer.PinnableVersionString` and
    `integrity: Schema.Option(CorepackIntegrityHash)` fields.
[^package-manager-test]: `packages/package-json/__test__/PackageManager.test.ts`
    — the "PackageManager consolidation" group: the two identity
    assertions with controls and the `SemVer.parseResult` equivalence
    corpus.
