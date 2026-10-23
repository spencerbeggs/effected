---
type: Decision
title: The Draft-07 meta-schema constant keeps its trailing hash
description: DRAFT_07_META_SCHEMA carries a trailing hash, matching the SchemaStore corpus convention and deliberately diverging from core's equivalent constant.
status: stable
sources:
  - id: store-document
    resource: ../../packages/schemastore/src/StoreDocument.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 2412fa6249fb6c38
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 47a7c1fb935ce382
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The Draft-07 meta-schema constant keeps its trailing hash

## Context

The Draft-07 meta-schema URI has a canonical form with an optional
trailing `#` fragment. `effect` core exposes its own equivalent
constant without one; `@effected/schemastore` needed to pick a spelling
for its own `DRAFT_07_META_SCHEMA` export.

## Decision

`DRAFT_07_META_SCHEMA` is `"http://json-schema.org/draft-07/schema#"`,
with the trailing `#`.[^store-document]

## Alternatives rejected

**Match core's constant exactly (no trailing `#`).** Rejected because
the SchemaStore corpus this package emits documents for consistently
uses the `#`-suffixed form, and matching the corpus convention this
package's output is judged against takes priority over matching an
internal-to-the-kit sibling constant that consumers of the emitted
documents never see.

## Consequences

The divergence from core's constant is documented directly on the
constant itself in source, so a future reader diffing the two does not
mistake it for a copy-paste error or an oversight — it is one of
several places this package deliberately trades internal consistency
with core for external fidelity to SchemaStore's own conventions.

[^store-document]: `packages/schemastore/src/StoreDocument.ts:16` —
    `export const DRAFT_07_META_SCHEMA = "http://json-schema.org/draft-07/schema#"`.
