---
type: Decision
title: No layerDefault on SchemaValidator or SchemaFile
description: Every service-shaped module ships a real layer and a test layer; a third layerDefault would only be a name for one of the two that already exist.
status: stable
sources:
  - id: schema-validator
    resource: ../../packages/schemastore/src/SchemaValidator.ts
  - id: schema-file
    resource: ../../packages/schemastore/src/SchemaFile.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-15T15:38:20Z
integrity:
  generated:
    body: 4a7f537556e351c2
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: f822e081c618a877
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
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
