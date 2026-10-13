---
type: Gotcha
title: A subpath entrypoint named after its own concept module fails at two layers
description: Naming a subpath export key the same as one of its concept modules, differing only in case, first breaks tsc outright and then, once renamed, resurfaces as a misleading CI-fatal API Extractor error.
status: stable
stale_after: "2027-01-13T00:00:00Z"
resource: ../../packages/schema-org/package.json
tags:
  - bundle
  - dx
sources:
  - id: schema-org-package-json
    resource: ../../packages/schema-org/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 2526db8ee65aafbe
---

# A subpath entrypoint named after its own concept module fails at two layers

## What a reader sees

A new subpath entrypoint is added for a concept module named
`Conformance.ts`, and the export key is chosen to match: `"./conformance":
"./src/conformance.ts"`. `tsc` immediately reports **TS1149**, "differs
from already included file name only in casing" — `src/conformance.ts`
collides with `src/Conformance.ts` on a case-insensitive filesystem, which
is every macOS dev machine.

## What a reader wrongly concludes

Renaming the *source file* — say to `src/conformanceEntry.ts` while
leaving the export key as `"./conformance"` — looks like it fixes the
collision, because `tsc` stops complaining.

## What is actually true

The emitted declaration name derives from the **export key**, not the
source file name. `"./conformance"` still emits `conformance.d.ts`, which
collides with the module's own `Conformance.d.ts`. The bundler sidesteps
the naming collision by writing `conformance2.d.ts`, but API Extractor —
still pointed at `conformance.d.ts` — resolves case-insensitively onto
the **module** instead of the entry. The symptom is a **CI-fatal
`ae-forgotten-export`** naming a symbol the entry visibly exports, which
sends a reader hunting a missing export that is not missing at all.

This is a live trap rather than a curiosity because the house convention
names concept modules in PascalCase for their API (see
[module-per-concept layout](../conventions/module-per-concept-layout.md)),
so any package growing a subpath named after one of its own concepts
walks straight into it.

## The check

Name the subpath for what it *does*, not for the class it happens to
lead with, and give the entry file a distinct name: `./validate` →
`src/conformance-entry.ts`, as `@effected/schema-org` does.[^schema-org-package-json]
This usually produces a better key anyway — `./validate` describes the
entry's whole contents where `./conformance` described only one of its
exports. Renaming the *concept module* to dodge the collision is the
wrong fix: it sacrifices the API-name convention to a build-tool
artifact.

[^schema-org-package-json]: `packages/schema-org/package.json` — `"./validate":
    "./src/conformance-entry.ts"`, an entry file name distinct from any
    concept module it re-exports.
