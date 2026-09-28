---
type: Convention
title: Schema standards
description: How @effected libraries model domain data with Effect Schema — Class over Struct, make vs parse, brand and Opaque, and the wire-provenance rule for byte-fidelity replay.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-schema
    resource: ../../.repos/effect/packages/effect/src/Schema.ts
  - id: spdx-expression
    resource: ../../packages/spdx/src/SpdxExpression.ts
  - id: package-json-funding
    resource: ../../packages/package-json/src/Funding.ts
  - id: package-json-person
    resource: ../../packages/package-json/src/Person.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T20:05:42Z
  body_sha256: 1bba05d1ec78bbc54c90a99edd14e5f990068a34ff73004d032400a0f85fe8b0
---

# Schema standards

- Named domain models are `Schema.Class` / `Schema.TaggedClass` — the
  schema IS the class with methods.[^effect-schema] `Schema.Struct` is
  only for small, anonymous local shapes.
- Construct with `X.make(...)`, never `new X(...)`. This rule is about
  **constructing from fields**, and it does not reserve `make` as the
  name for every entry point into a class. A model with an encoded
  **string** form needs a differently-named parser: `make` takes the
  field record and applies only field-level schema checks, so the house
  spelling for the string parser is `parse` (returning an `Effect`) plus
  `parseResult` (returning a sync `Result`), with `make` still the fields
  constructor. `@effected/spdx`'s `SpdxExpression` is the worked example —
  `make` builds a node from fields, `parseResult` parses the wire
  string.[^spdx-expression]
- Never define parallel schemas for one logical entity when only encoding
  differs — use field-level transformations (`Schema.decodeTo` /
  `encodeTo`), or derive variants with `pick` / `omit` / `partial` /
  `mutable`. Duplication is reserved for genuinely different models
  (creation payload vs. persisted entity, public API vs. internal
  domain).
- `Schema.optionalKey` for omissible object fields (`optional` alone
  produces `T | undefined`, still present as a key).
- `Schema.brand` for validated scalar identifiers; `Schema.Opaque` for
  schema-backed nominal types.
- Intrinsic constraints attach in-schema via `.check(...)`
  (`isMinLength`, `isPattern`, `isUUID`, …); business-rule validation
  that depends on service state stays outside the schema.
- String-codec field models must be canonical — exactly one type-level
  value per encoded string — or decode/encode round-trips fail.
- Write every `isPattern` regex with no lookaround or backreferences, none
  of the `i`/`m`/`v` flags, and always the `u` flag. Effect's native
  Arbitrary regexp compiler (`internal/arbitrary/regexp.ts`) cannot compile
  lookaround, backreferences or `i`/`m`/`v`, and then silently drops the
  pattern from generation, leaving a residual filter that exhausts; `u` is
  the flag it supports. JSON Schema export needs `u` too: `isPattern`
  exports `pattern` only when the regex's flags match `/^[dg]*uy?$/`, so a
  flag-free regex publishes a bare `{"type":"string"}` while decoding still
  enforces it. Every `isPattern` in `packages/*/src` carries `u`, pinned per
  package by a `toJsonSchemaDocument` test.
- `Schema.suspend` for recursive schemas.
- In Effect code prefer `Schema.decodeUnknownEffect` /
  `encodeUnknownEffect`; the `Sync` variants are for explicit sync
  boundaries only.
- Use `.annotate(...)` for metadata; derived tooling
  (`toJsonSchemaDocument`, `toArbitrary`, `toEquivalence`) is how docs and
  tests derive from the one schema source of truth.

## Wire provenance keys on leaf instances, never on rebuilt containers

Several kit models remember the exact wire value an instance decoded
from — in a `WeakMap` or `WeakSet` beside the instance, never inside
it — and replay it on encode for byte-level fidelity.
`@effected/package-json`'s `Funding` and `Person` classes both do this:
each keeps a module-private `WeakMap` or `WeakSet` keyed on the decoded
instance, never a field on the
instance.[^package-json-funding][^package-json-person] Provenance is kept
outside the value on purpose: it must not appear in the encoded output,
must not affect structural equality, and must not survive being copied
into a hand-built value.

**The trap:** a `decodeTo` target of `Schema.Array(...)` or
`Schema.Struct(...)` does not preserve the object identity the transform
returned — the container is rebuilt on the way out, so a map keyed on it
is empty by the time `encode` runs. There is no error and no warning;
provenance is simply never found, and a fidelity guarantee degrades
silently to the canonical form. This is the failure mode hardest to catch
in review, because the output is still legal — just not byte-identical
to what was decoded.

Two rules follow, and every provenance model in the kit depends on both:

1. **Key provenance on the leaf instance the transform constructed**,
   never on the container it was placed into. Where the fact being
   remembered is about the *container* — "this field was written bare
   rather than as an array" — hang it on the single leaf that was the
   field, and guard the replay on that leaf still being alone.
2. **Guard every replay branch on the value still matching its
   provenance, and test each branch by mutating in place.**
   `Schema.Class` instances are not frozen, so an unguarded replay writes
   the original wire form back and discards an edit. A test that
   *rebuilds* the value cannot reach the replay path at all, so a suite
   can look thorough while never executing the branch that is wrong.

[^effect-schema]: `.repos/effect/packages/effect/src/Schema.ts` —
    `Class`, `TaggedClass` and `TaggedError` constructors.
[^spdx-expression]: `packages/spdx/src/SpdxExpression.ts` — `make`
    builds from fields (`LicenseNode.make`, `WithExceptionNode.make`);
    `parseResult` parses the encoded string and `parse` derives the
    `Effect` form from it.
[^package-json-funding]: `packages/package-json/src/Funding.ts` — a
    module-private `WeakMap`/`WeakSet` records the decoded wire shape
    beside each `Funding` instance.
[^package-json-person]: `packages/package-json/src/Person.ts` — the same
    pattern for `Person`'s wire form.
