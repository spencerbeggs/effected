---
type: Invariant
title: CorepackIntegrityHash is consumed by identity, and only a runtime identity assertion can see a re-fork
description: "Both pin-tail models — @effected/npm's PackageManagerPin.integrity and @effected/package-json's PackageManager.integrity — consume the one CorepackIntegrityHash schema value; because a Schema.check is erased from the built type, a private copy that merely agrees with it is neither a type error nor a behaviour change, so each consumer's suite asserts object identity with a control against the unrestricted brand."
status: stable
resource: ../../packages/npm/__test__/IntegrityHash.test.ts
tags:
  - testing
  - architecture
sources:
  - id: npm-integrity-test
    resource: ../../packages/npm/__test__/IntegrityHash.test.ts
  - id: package-json-manager-test
    resource: ../../packages/package-json/__test__/PackageManager.test.ts
  - id: npm-integrity-source
    resource: ../../packages/npm/src/IntegrityHash.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 73b4e393c33e48ce
---

# CorepackIntegrityHash is consumed by identity, and only a runtime identity assertion can see a re-fork

## The property

`CorepackIntegrityHash` — the corepack-only narrowing of `IntegrityHash` to
`<algo>.<hex>`, sha224 included — has exactly one home, in
`@effected/npm`'s `IntegrityHash` module.[^npm-integrity-source] Both
surfaces that model a package-manager pin tail consume that very value
rather than re-deriving the restriction: `PackageManagerPin.integrity` in
the same package, and `@effected/package-json`'s `PackageManager.integrity`.
A caller decoding a pin through either model is therefore decoding through
the same check, and a rule change in one place is a rule change in both.

## The mechanism

The type system cannot enforce this. A `Schema.check` is erased from the
built `.d.ts`, so a consumer that severs itself from the shared schema and
keeps a private copy of the same regex produces neither a type error nor a
behavioural difference — every rejection test still passes and `tsc` is
silent. What discriminates is the field schema's **object identity**, so each
consumer's suite pins it directly:

- `PackageManagerPin.fields.integrity.schema === CorepackIntegrityHash` —
  a `Schema.optionalKey(X)` keeps the inner schema on
  `.schema`.[^npm-integrity-test]
- `PackageManager.fields.integrity.value === CorepackIntegrityHash` — a
  `Schema.Option(X)` keeps it on `.value`.[^package-json-manager-test]

Each assertion carries a control, `notStrictEqual` against the unrestricted
`IntegrityHash` brand, proving the assertion discriminates: a consumer that
falls back to the wide brand fails the control, which a type error would
never catch. The comparison is widened to `unknown` because the two schema
values carry different statics and no longer unify as types; the claim is
runtime identity, not assignability.

## What a refactor would have to break

A faithful re-fork — copying the restriction into the consumer and pointing
the field at the copy — fails both assertions with vitest's "compared values
have no visual difference," which is the point: the values are
indistinguishable by shape and distinguishable only by identity. Never
downgrade the assertion to a behavioural test (decode a good and a bad value
through the field), because that is exactly the test a re-fork passes. The
invariant stops holding only if a consumer removes the identity assertion
along with the import, or if `IntegrityHash.ts` starts exporting the
narrowing under a second value.

The `package-json` side of this edge, together with the sibling version edge
to `@effected/semver`, is pinned from the consumer's view in
[PackageManager shares strict schemas by identity](package-manager-shares-strict-schemas-by-identity.md).

[^npm-integrity-source]: `packages/npm/src/IntegrityHash.ts` — the
    `corepackRestricted` narrowing and the exported `CorepackIntegrityHash`
    it backs, the single home for the corepack-only rule.
[^npm-integrity-test]: `packages/npm/__test__/IntegrityHash.test.ts:143-156`
    — `PackageManagerPin.integrity IS this schema, not a copy that agrees
    with it`, with the `notStrictEqual` control against `IntegrityHash`.
[^package-json-manager-test]: `packages/package-json/__test__/PackageManager.test.ts:219-230`
    — `integrity IS @effected/npm's shared corepack schema`, with the same
    control.
