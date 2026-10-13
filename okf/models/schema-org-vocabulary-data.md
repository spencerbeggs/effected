---
type: DataModel
title: The committed schema.org vocabulary document
description: The vendored schema.org -current release document that seeds @effected/schema-org's interned vocabulary table, and the invariants a regeneration must not let slip.
status: stable
resource: ../../packages/schema-org/lib/data/schemaorg-current-https.jsonld
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 378637bde3c84548
---

# The committed schema.org vocabulary document

`lib/data/schemaorg-current-https.jsonld` is schema.org's own published
`-current` release document (1,550,917 bytes as vendored), committed into
[`@effected/schema-org`](../modules/schema-org.md) rather than consumed as a
vendored submodule. It is the sole source for
`src/internal/vocabulary.ts`, the interned table behind
[`Vocabulary` and `Conformance`](../interfaces/schema-org-validate.md).

## What an entry holds

The document is a JSON-LD graph of schema.org's own `rdfs:Class` and
`rdf:Property` terms (plus a small set of foreign alignment terms sharing
the same shapes). A class node carries `@id`, `@type` and zero or more
`rdfs:subClassOf` parent references — the hierarchy is a DAG, not a tree,
so a class may have more than one parent. A property node carries `@id`,
`@type` and one or more `domainIncludes` targets naming the classes it may
legally appear on. The `-current` variant excludes retired terms, which is
why it is vendored instead of `-all`.

The document additionally names its own release inside its content, which
the generator surfaces as `Vocabulary.version` (`"30.0"` as vendored, held
in `src/internal/vocabulary.ts`'s `VOCABULARY_VERSION` constant).

## What derives from it

`lib/scripts/generate-data.ts` reads this file and writes
`src/internal/vocabulary.ts` — the interned name tables for classes and
properties, the parent rows (the `rdfs:subClassOf` closure), the domain
rows (the `domainIncludes` sets), both `supersededBy` maps, the declared
foreign prefixes taken from the document's own `@context`, and the version
constant. Index rows are comma-joined strings rather than nested number
arrays specifically so the file is a fixpoint under the repo's Biome
formatter. `Vocabulary` and `Conformance` answer every legality question by
reading this generated table; nothing in `src/` reads the source document
at runtime.

## What breaks if the document is wrong or stale

The document is internally inconsistent in ways the generator has to
guard against rather than trust: a few properties name a `domainIncludes`
class the document never declares (existing only in `-all`), and a naive
generator indexing the type table by name would get `undefined` flowing
into an interned index — a silent corruption that ships as a validator
that quietly misjudges some property's legality. The generator asserts
instead of assuming: every `domainIncludes` target must resolve to a
declared native class or be one of a small set of exceptions recorded by
name in the generated header; every parent must resolve to a declared
native class or a prefix the document's own `@context` declares; every
interned index must be in range. A failed assertion aborts regeneration
rather than emitting a damaged table.

If the document is stale relative to a real schema.org release, the
vendored vocabulary silently under- or over-restricts what
`Conformance.check` accepts: a term that moved domain, or a class that
gained a parent, changes what the gate accepts without any local signal
that anything changed. This is why bumping the document is treated as a
vocabulary review rather than a routine update — see [the regeneration
runbook](../runbooks/regenerate-schema-org-vocabulary.md).

## Provenance

Committed rather than vendored as a git submodule: the upstream schema.org
release repository is roughly 254 MB, and this one file is the single
release document read from it (1.5 MB as vendored) — a submodule's sparse
configuration does not travel with a clone, so every clone and CI checkout
would otherwise pay the full upstream history to reach one file. See [the
generator-input convention](../conventions/generator-input-is-a-committed-file.md).
`Vocabulary.version` is the provenance marker a consumer's own CI can read
to report which schema.org release its conformance gate ran against.
