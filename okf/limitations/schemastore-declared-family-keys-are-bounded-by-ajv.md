---
type: Limitation
title: A declared-family key must be a name ajv can register, and its payload cannot carry an $id
description: "The x-ai- namespace admits any key by prefix, but the engine gate rejects the whole document — as a root-pathed finding — when a key uses a character outside ajv's keyword grammar or when an $id (or repeated $anchor) sits anywhere inside a declared-family payload; the bound is ajv's, and ajv is the gate SchemaStore itself runs."
status: draft
bounds: ../modules/schemastore.md
tags:
  - compat
sources:
  - id: keyword-families
    resource: ../../packages/schemastore/src/KeywordFamilies.ts
  - id: engine-suite
    resource: ../../packages/schemastore-cli/__test__/ajv-validator.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 27f8711760d663d0
---

# A declared-family key must be a name ajv can register, and its payload cannot carry an $id

## Condition

`KeywordFamilies` declares the house `x-ai-` machine-annotation family
as a **namespace**, not a vocabulary: any key carrying the prefix is
declared, and the package enumerates no key set.[^keyword-families] Two
things a namespace cannot promise are bounded by the engine that gates
every published document:

1. **The key's characters.** After the prefix a key may use only
   `[A-Za-z0-9_$:-]`, because ajv holds a keyword name to
   `/^[a-z_$][a-z0-9_$:-]*$/i`. A dot, a space, a slash, an `@`, a `+` or
   any non-ASCII character is a key the engine cannot register.
2. **The payload's contents.** A declared-family value must not contain
   an `$id` — or a repeated `$anchor` — at **any** depth, not merely as
   its own top-level key. ajv's reference collection walks unknown
   keywords looking for them, so a colliding id buried inside an
   annotation payload collides with the document's own. An empty-string
   `$id` collides too: it resolves to the root id.

## Symptom

The CLI's `AjvValidator` rejects the whole document with one root-pathed
`ValidationFinding`, never an error: a bad key name is reported as a
finding rather than a mechanism failure, and a buried `$id` fails the
compile the same way.[^engine-suite] `DocumentLint` answers nothing —
the key *is* declared, so the lint is right to allow it — which is what
makes the verdict look like an engine fault rather than a bounded key.
The payload itself is opaque to the engine: a dotted key *inside* an
`x-ai-hint` object is data, not a keyword, and passes.

## Why this is acceptable

ajv strict mode is the gate SchemaStore itself runs on submitted
schemas, so a document the kit's engine rejects would be rejected
upstream regardless. Narrowing the namespace to what ajv can register
is the contract, not a defect in it; the alternative — a pre-registration
key filter in the library — would let the library pass a document the
store's own gate refuses. The `$id` bound follows the same reasoning: the
library's `#/definitions` → `#/$defs` rewrite deliberately does not
descend into a declared-family payload, so it cannot rewrite or strip an
id there, and a payload is meant to be opaque advice to a reader, not a
schema fragment.

## What a fix would take

Nothing in this package. A consumer who needs a dotted or non-ASCII key
renames it; a consumer whose payload needs an `$id`-shaped field nests
it under a different key name. If ajv widened its keyword grammar or
stopped walking unknown keywords for references, the bound would lift
with the engine's next major.

[^keyword-families]: `packages/schemastore/src/KeywordFamilies.ts` — the
    `x-ai-` namespace doc block: the character rule, the `$id`/`$anchor`
    rule and the empty-string `$id` case.
[^engine-suite]: `packages/schemastore-cli/__test__/ajv-validator.test.ts`
    — "reports a declared keyword ajv's name grammar rejects as a finding,
    not an error" and "does not descend into a declared keyword's
    payload".
