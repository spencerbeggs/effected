---
type: Interface
title: "@effected/schema-org validate entrypoint"
description: The offline conformance validator and vocabulary read API over the vendored schema.org dataset, exposed only from the ./validate subpath.
status: stable
kind: api
resource: ../../packages/schema-org/src/conformance-entry.ts
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: ae2a903ac75d1d3610f7f16085e14425f16dd37ab23fc7cc820e79a7183fe862
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:42.785Z
---

# @effected/schema-org validate entrypoint

The `./validate` entrypoint of [`@effected/schema-org`](../modules/schema-org.md):
`Conformance`, the offline validator; `Vocabulary`, the read API over the
vendored schema.org dataset; and the generator that produces that dataset.
It is a separate entrypoint so that a consumer that only builds graphs
never loads the vocabulary table — see [the module layout and two
entrypoints](../modules/schema-org.md#module-layout-and-the-two-entrypoints).

The gate answers one question offline: does schema.org define this
`@type`, and is every property on it `domainIncludes`-legal for that type?
That is the failure a consumer actually hits — not malformed JSON, but a
plausible property schema.org does not define on that type. The authentic
example is that `softwareVersion` is defined on `SoftwareApplication`, not
on `SoftwareSourceCode` (which spells it `version`): it reads correct,
serializes fine and is silently ignored downstream. See [the
property-not-on-type gotcha](../gotchas/schema-org-property-not-on-type-silently-ignored.md).

## How legality is resolved: five traps

A naive `domainIncludes.includes(type)` check is wrong in five separate
ways, and the first one rejects the consumer's very first graph. Each was
confirmed against the vendored document; `src/Vocabulary.ts` is the
implementation.

1. **Legality is inherited, so the check is set membership over the full
   ancestor closure.** `schema:license` carries a single `domainIncludes`
   entry, `CreativeWork`, so `license` on a `SoftwareSourceCode` is legal
   only through `SoftwareSourceCode → CreativeWork → Thing`. A gate that
   fails a correct graph gets switched off, and a switched-off gate
   protects nothing.
2. **A property may name many domains, so it is membership, not
   equality.** The check is a non-empty intersection between the
   property's domain set and the node type's ancestor closure.
3. **The hierarchy is a DAG, not a tree, so the ancestor walk is a
   cycle-guarded set union.** Dozens of classes have multiple parents; a
   parent-chain walk silently truncates the closure and produces false
   rejections indistinguishable from trap 1.
4. **Foreign parents appear on real classes, and the walk must
   tolerate-and-skip them.** A handful of native classes carry a parent
   outside the schema namespace beside a native one that carries the real
   chain. A walk that throws crashes; one that abandons the class drops a
   legitimate chain and false-rejects. It skips that branch and keeps the
   others.
5. **The vocabulary document contains foreign alignment terms, which must
   not be ingested as schema.org terms.** They carry the same `@type` as
   native terms, so the generator filters by `@id` prefix, never by
   `@type`.

**A prefixed term at validation time is resolved three ways, and two are
easy to get silently wrong** (`src/Conformance.ts` documents each):
`schema:license` is native and validates identically to `license`; a
prefix the vocabulary document's own `@context` declares (`gs1:`,
`fibo-…`) is skipped in silence, because a consumer who wrote it opted
into a vocabulary this package does not claim to validate; an undeclared
prefix (`bogus:`) is reported as unknown, because it is at least as likely
a typo. A "has a colon, skip it" rule would stop validating everything a
consumer writes in prefixed form.

## The surface

Two entry points, following the [sync-primitive
policy](../conventions/sync-primitive-policy.md):

- **`Conformance.check(graph)` — total, never fails.** Reporting is not a
  failure mode; a lint host wants a list.
- **`Conformance.validateResult(graph, options?)`** — the gate
  (`src/Conformance.ts:400`), whose `NonConformantGraphError` carries the
  full issue array. `Conformance.validate` is its `Effect.fromResult` twin
  behind a span. `validateResult` is defined in terms of `check`, so the
  two cannot drift.

`ConformanceIssue` is a tagged union of `Schema.TaggedClass` variants —
unknown term, property-not-on-type (`src/Conformance.ts:66`), the two
deprecation kinds and dangling reference — each carrying the offending
node's `@id`, its `@type` and the property name. Deprecated
(`supersededBy`) terms are valid-but-flagged, never rejected, exactly as
`@effected/spdx` treats deprecated ids.

**The outcome is three-valued, and the three are never conflated.**
*Legal*, *property-not-on-type* (a real term in the wrong place) and
*unknown term* (a term schema.org does not define at all) are distinct
answers with different fixes. Unknown terms are always reported; the
`unknownTerms: "fail"` option promotes them to a failure for a
closed-world caller. This distinction is only honest because [the table is
complete](#vendored-data-and-regeneration): under a scoped subset,
"unknown" is irreducibly ambiguous between *you misspelled it* and *we did
not ship that part*.

Issues carry no severity field. Severity is the consumer's policy, not a
fact about the graph; `validateResult` fails on the structural kinds by
default and takes `ConformanceOptions` to widen the gate for deprecations
and dangling references.

**The per-kind gate is exhaustiveness-checked with `satisfies never`, and
that is load-bearing.** A `default: return false` would silently pass any
issue kind added later — reported by `check`, ignored by every gate, CI
green. Adding an issue kind without deciding its gate behaviour is a
compile error instead.

`Vocabulary` is the same data as a read API — `hasType`, `isPropertyOn`,
`propertiesOf`, `ancestorsOf`, `supersededBy`, `version` — exported because
a consumer building a different algebra over schema.org should not have to
re-vendor the dataset, and because the package's own tests read it. It is
a static class.

### What conformance is not

schema.org conformance is not Google rich-results eligibility. Google
requires properties schema.org does not, forbids nothing schema.org
allows and changes its policy on its own schedule. A Google-policy checker
is a different artifact with a different cadence and does not belong in a
pure vocabulary package; the README says so, because a consumer's CI gate
will otherwise be read as a Google gate.

`rangeIncludes` is not validated either, deliberately: a range check needs
the value's schema.org type, and a literal's type is ambiguous
(`"2026-01-01"` is `Text`, `Date` and arguably `URL`-adjacent), so range
checking produces false positives on correct input. Domain checking is the
high-signal half. `rangeIncludes` data is therefore not shipped — it is
used only to justify the full table below, never carried at runtime.

## Vendored data and regeneration

`lib/data/schemaorg-current-https.jsonld` is schema.org's published
`-current` release document, committed into this package; the release it
carries is recorded as `Vocabulary.version`. Full provenance, what derives
from it and what breaks if it falls out of sync are in [the vocabulary data
model](../models/schema-org-vocabulary-data.md); the regeneration procedure
is [its own runbook](../runbooks/regenerate-schema-org-vocabulary.md).

### What ships: the full table

The whole schema-native vocabulary ships — every class and every property,
including `pending` and the hosted extensions — interned, with no scoping
by closure and no section cut. Two arguments settle it:

- **The range closure.** The six modeled types' properties name dozens of
  non-datatype range types, and nearly all fall outside any closure scoped
  to those six (`Organization.address` → `PostalAddress`,
  `CreativeWork.image` → `ImageObject`). Correct graphs reach those types
  on day one, so a scoped table does not merely lag the vocabulary, it
  fails the first realistic graph — trap 1 by a different road.
- **Honesty of `UnknownTerm`.** A scoped table cannot distinguish "you
  misspelled it" from "we did not ship that part", which is precisely the
  distinction the three-valued outcome depends on. Completeness is not a
  size decision; it is what makes the answer honest.

Interning is what makes "everything" affordable: type and property names
are stored once in string tables and referenced by index from the parent
and domain rows. Index rows are comma-joined strings, not nested number
arrays — a long nested array is re-wrapped by Biome, so the generator and
the formatter would fight forever and the file would never be a fixpoint; a
string literal is one Biome cannot break, and it is smaller. Rows decode
lazily and memoize per type index. `__test__/Vocabulary.test.ts` pins the
table's byte size with both a ceiling and a floor — the floor is the
load-bearing half, because a half-run generation produces a truncated table
that passes every legality test by simply knowing nothing.

`src/internal/vocabulary.ts` carries the interned name tables, the parent
rows, the domain rows, both `supersededBy` maps, the declared foreign
prefixes and the version constant. They answer the two questions the
validator asks and nothing else: no labels, comments, examples or ranges.

### The upstream document is data, not truth

The `-current` document is internally inconsistent: a few properties carry
a `domainIncludes` target that the document never declares as a class (it
exists only in `-all`). A generator that indexes the type table by name
gets `undefined`, and `undefined` flowing into an interned index is a
silent corruption that ships. So the generator asserts rather than
assumes, and fails regeneration rather than emitting a damaged table:

1. Every `domainIncludes` target resolves to a declared native class, or
   the generator fails naming the term and its target. The known
   exceptions are dropped with a recorded note in the generated header,
   never silently.
2. Every parent resolves to a declared native class or carries a prefix
   the document's own `@context` declares. An unrecognized prefix is a new
   alignment vocabulary and a decision for a human.
3. Every interned index is in range.

The generated header's notes block records what the document could not
answer, so the next regeneration can tell a new inconsistency from a known
one.

## Testing

`__test__/Conformance.test.ts` and `__test__/Vocabulary.test.ts`, with
small hand-authored graphs each pinning one answer and a `README.md`
beside the fixtures carrying the fixture provenance. The cases that matter
most:

- **`license` on `SoftwareSourceCode` → clean.** Legal only by inheritance
  (trap 1), and a property the consumer's first graph passes. This is the
  most important fixture in the suite.
- A multi-parent type carrying a property inherited through its second
  parent → clean. Kills the single-parent-walk mutant that the trap-1
  fixture alone does not.
- A property with many domains on a type matching a non-first entry →
  clean. Kills equality-instead-of-membership.
- A declared-foreign-prefix term in a catch-all → no issue at all; an
  undeclared prefix → reported. Pins the three-way prefix rule.
- `softwareVersion` in a `SoftwareSourceCode`'s `additional` →
  `PropertyNotOnType`. The authentic false-acceptance case.
- A `supersededBy` term → the deprecation issue carrying the successor, and
  not rejected by the default gate.
- An invented `@type` → `UnknownTerm`, and under `unknownTerms: "fail"` a
  failure. A `pending` term → clean, which pins the full table.
- Duplicate `@id` and colliding `additional` key → build-time failures, not
  issues; a dangling `NodeRef` → an issue and a clean `buildResult`.

The generator's own assertions are exercised at regeneration time, not by
a graph fixture. Nothing in the suite invokes the generator.

**On the oracle.** The vendored vocabulary document *is* the oracle, and
every legality assertion is checked against it rather than against a
snapshot of the validator's output.
