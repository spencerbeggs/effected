---
type: Decision
title: No layerDefault on SchemaValidator or SchemaFile
description: Every service-shaped module ships a real layer and a test layer; a third layerDefault would only be a name for one of the two that already exist.
status: draft
sources:
  - id: claude-modules
    resource: ../../packages/schemastore/CLAUDE.modules.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: cc1d92c4d858a708eb6d841d02d23710c1531d220bb7b8fb00d4e90e70824acc
---

# No layerDefault on SchemaValidator or SchemaFile

## Context

Some Effect services expose a `layerDefault` alongside `layer` and a
test layer, as a shorthand for "the one you almost certainly want."
`SchemaValidator` and `SchemaFile` were each considered for one.

## Decision

Neither module ships a `layerDefault`. Every service-shaped module in
this package ships exactly a real layer (`layer`) and a test layer
(`makeTest`/`layerTest` or equivalent).

## Alternatives rejected

**Add `layerDefault` as an alias for the real layer.** Rejected because
with only two layers per service — the real implementation and the test
implementation — a third name would only restate one of the two that
already exist under a different label. `layerDefault` earns its keep
only when a module has three or more legitimate layer choices and needs
to name which one is conventional; with two, the choice is already
unambiguous from the two names alone.

## Consequences

A consumer names `SchemaFile.layer`, or `AjvValidator.layer` from
`@effected/schemastore-cli` for the validator (the real engine moved
there on 2026-09-15 — see
[the engine lives in the CLI](schemastore-engine-lives-in-the-cli.md)),
for production wiring, and `makeTest`/`layerTest` for tests, with no
third name to learn or keep in sync with the other two.
