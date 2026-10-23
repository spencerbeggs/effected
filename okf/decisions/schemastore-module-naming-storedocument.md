---
type: Decision
title: "The assembly module is named StoreDocument, not SchemaDocument"
description: Naming the assembly module StoreDocument rather than SchemaDocument, to avoid a name that reads like the banned general-JSON-Schema scope.
status: stable
sources:
  - id: store-document
    resource: ../../packages/schemastore/src/StoreDocument.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 0960fd02615bfbbc
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: da770fbac6f0af8f
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The assembly module is named StoreDocument, not SchemaDocument

## Context

`@effected/schemastore`'s central assembly module builds the
`$schema`/`$id`/`root`/`defs` document shape SchemaStore expects, and
needs a name that does not imply a broader mandate than the package
actually has.

## Decision

Name the module `StoreDocument`.

## Alternatives rejected

**`SchemaDocument`.** Rejected because it reads like the general-purpose
JSON Schema construction and manipulation the package's
[scope fence](../modules/schemastore.md#scope-fence) explicitly excludes.
A name naming "schema" as the noun invites exactly the scope creep the
fence exists to prevent — a reader encountering `SchemaDocument` would
reasonably expect it to build or transform arbitrary JSON Schema
documents, when the module in fact only assembles the specific
SchemaStore publication shape from a document core already generated.

## Consequences

The name itself now enforces the scope fence at the point a new
contributor first encounters the module: `StoreDocument` names the
SchemaStore-shaped artifact, not a general schema value, which makes it
harder to accidentally grow the module into the general JSON Schema
package the fence forbids.
