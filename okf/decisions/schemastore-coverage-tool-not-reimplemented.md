---
type: Decision
title: SchemaStore's own coverage tool is not reimplemented
description: The package treats SchemaStore's own coverage checks as candidate inspiration only, rather than reimplementing them as a shipped feature.
status: draft
sources:
  - id: claude-md
    resource: ../../packages/schemastore/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c8648f6e60cbc615
---

# SchemaStore's own coverage tool is not reimplemented

## Context

The upstream SchemaStore project runs its own coverage checks over
submitted schemas and catalog entries. `@effected/schemastore` could
have reimplemented an equivalent check as a shipped feature.

## Decision

The store's own coverage tool is not reimplemented. Its checks serve as
candidate inspiration for what `DocumentLint` or `CatalogEntry`'s
`fileMatch` hygiene lint might eventually cover, never as a target this
package is obligated to replicate feature-for-feature.

## Alternatives rejected

**Port or wrap the upstream coverage tool as a shipped module.**
Rejected under the [scope fence](../modules/schemastore.md#scope-fence):
the package's job is producing artifacts in the shape SchemaStore
expects, not reimplementing the store's own submission tooling. A
coverage tool judges a corpus of already-submitted schemas against
store-wide policy; this package's lints judge one document or catalog
entry against structural and hygiene rules that matter regardless of
whether the document is ever submitted upstream.

## Consequences

`DocumentLint` and `CatalogEntry.lint` stay narrowly scoped to what this
package can check locally and quickly, without growing a dependency on
or a maintenance burden shadowing an external project's own tooling.
Anyone submitting a generated schema to SchemaStore proper still runs
the upstream coverage tool as part of that submission, independent of
what this package validated.
