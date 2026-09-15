---
type: Decision
title: Generated objects are closed by default, departing from core's open default
description: "StoreDocument.fromSchema generates with onExcessProperty: error so every object is emitted with additionalProperties false, because a published document is a contract; core's own default flipped open at rc.113 and the package no longer follows it."
status: draft
tags:
  - compat
sources:
  - id: store-document
    resource: ../../packages/schemastore/src/StoreDocument.ts
  - id: schema-target
    resource: ../../packages/schemastore/src/SchemaTarget.ts
generated:
  by: "okfit/claude-code"
---

# Generated objects are closed by default, departing from core's open default

## Context

`StoreDocument.fromSchema` hands the source schema to core's
`Schema.toJsonSchemaDocument`, whose `onExcessProperty` option decides
whether each generated object carries `additionalProperties: false`. Core's
own default flipped from `"error"` (closed) to `"ignore"` (open) at
rc.113. Until this decision the package inherited whichever default core
shipped, so the same schema produced closed objects on one pin and open
ones on the next, and every consumer that wanted a closed document had to
pin `jsonSchema: { onExcessProperty: "error" }` on every target.

## Decision

`StoreDocument.fromSchema` spreads `onExcessProperty: "error"` ahead of
the caller's `jsonSchema`, so every object in an emitted document is
closed unless a target says otherwise.[^store-document] A published JSON
Schema is a contract: it exists so an editor or a validator can refuse a
typo'd key, and an open object accepts that key without complaint. A
target that genuinely wants open objects passes
`jsonSchema: { onExcessProperty: "ignore" }`, which reopens that one
document; the option stays on the target rather than the pipeline so the
document remains self-describing (#688).[^schema-target]

## Alternatives rejected

**Keep following core's default.** Rejected because the package's output
would then change meaning on a pin advance with no change to any source
schema — exactly the silent contract change `DocumentDiff` exists to
catch — and because open objects are the wrong default for a document
whose whole job is to be a contract.

**Require every target to spell the option.** Rejected because the pin
existed on every target in every consumer already; a default that has to
be repeated everywhere is not a default, and one forgotten target ships an
open document.

## Consequences

The change is breaking for any consumer that relied on the open default
after rc.113: their generated documents now carry
`additionalProperties: false` and `DocumentDiff` classifies the change as
`"contract"`, so a published, pinned label refuses to rewrite under the
default drift policy until the version is bumped or the target reopens
itself. The `SchemaTarget.jsonSchema` rule in the package context is
therefore stated in the reopening direction: the target option is what
reopens a document that was published open, not what closes one.

[^store-document]: `packages/schemastore/src/StoreDocument.ts` — the
    `onExcessProperty: "error"` spread ahead of `options.jsonSchema` in
    `fromSchemaResult`, and the `StoreDocumentOptions.jsonSchema` doc
    comment stating the default.
[^schema-target]: `packages/schemastore/src/SchemaTarget.ts` — the
    `jsonSchema` field's doc comment: `"ignore"` reopens a document's
    objects, which `fromSchema` closes by default.
