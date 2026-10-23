---
type: Decision
title: No SchemaVersioning.plan surface
description: SchemaVersioning ships no separate planning function, because catalogUrls already sorts and dedupes the version set a plan would compute.
status: stable
sources:
  - id: versioning
    resource: ../../packages/schemastore/src/SchemaVersioning.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8fd0f27ea3fa36e8
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 6a75eb3dd531fd1a
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# No SchemaVersioning.plan surface

## Context

A version-management module often grows a "plan" function that inspects
the current version set and proposes the next steps. `SchemaVersioning`
was considered for one.

## Decision

`SchemaVersioning` ships no `plan` function.

## Alternatives rejected

**Add `SchemaVersioning.plan` to enumerate or sequence pending version
transitions.** Rejected because `catalogUrls` already sorts and dedupes
the version set for the catalog entry it assembles — a separate planning
surface would only restate, under a new name, a computation the existing
catalog derivation already performs. Shipping both would create two
places that could disagree about what the version set looks like.

## Consequences

Consumers needing a view of the version set reach for `catalogUrls` (via
`CatalogEntry.assemble`) rather than a dedicated planning API, keeping
the version-set computation in one place.
