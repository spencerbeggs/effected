---
type: Runbook
title: Regenerate the vendored schema.org vocabulary table
description: The hand-run procedure for refreshing @effected/schema-org's interned vocabulary literals after a schema.org release.
status: stable
resource: ../../packages/schema-org/lib/scripts/generate-data.ts
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 2feffa80397fa8a6
---

# Regenerate the vendored schema.org vocabulary table

## Trigger

schema.org has published a new `-current` release and the vendored table
in `src/internal/vocabulary.ts` should reflect it — a new class, a moved
property domain, a newly superseded term, or a fixed inconsistency in the
released document itself.

## Steps

1. Replace `packages/schema-org/lib/data/schemaorg-current-https.jsonld`
   with the new release's `-current` document (not `-all` — retired terms
   are deliberately excluded).
2. Run the generator by hand:

   ```bash
   pnpm --filter @effected/schema-org exec tsx lib/scripts/generate-data.ts
   ```

   It rewrites only `src/internal/vocabulary.ts`'s data literals by byte
   span via `oxc-parser` — the module header, types and hand-authored
   derived lookups are untouched. It reads only the committed document and
   the `effect` peer (for the `Graph.directed` / `Graph.isAcyclic`
   DAG-cycle assertion); it never fetches over the network and never runs
   in CI or the test suite.
3. Let the generator's own assertions run to completion. Each aborts the
   run rather than emitting a damaged table:
   - Every `domainIncludes` target resolves to a declared native class, or
     is one of the small set of known exceptions recorded by name in the
     generated header.
   - Every `rdfs:subClassOf` parent resolves to a declared native class or
     carries a prefix the document's own `@context` declares. An
     unrecognized prefix is a new alignment vocabulary and a decision for a
     human, not something to silently drop or silently accept.
   - The `rdfs:subClassOf` relation is asserted acyclic (`Graph.isAcyclic`);
     a cycle fails, naming the classes in the offending strongly-connected
     component.
   - Every interned index is in range.
4. Diff the regenerated `src/internal/vocabulary.ts`. Per the kit's
   oracle-bump discipline this is a **vocabulary review, not a version
   bump**: read what moved (a term that changed domain, a class that
   gained a parent, a newly superseded term) rather than accepting the diff
   unread. `Vocabulary.version` in the diff should match the new release.
5. Run the package's test suite:

   ```bash
   pnpm vitest run packages/schema-org
   ```

   `__test__/Vocabulary.test.ts` pins the generated table's byte size with
   both a ceiling and a floor; a floor failure means the generation
   silently truncated (a half-run generator would otherwise pass every
   legality test by simply knowing nothing). `__test__/Conformance.test.ts`
   exercises the fixed corpus of hand-authored graphs against the new
   table.
6. Commit the replaced source document and the regenerated
   `src/internal/vocabulary.ts` together as one change.

## Observable end state

`src/internal/vocabulary.ts` reflects the new schema.org release;
`Vocabulary.version` matches it; the generator's coverage, cycle and
range assertions all passed; `pnpm vitest run packages/schema-org` passes,
including the byte-size floor/ceiling assertion; and the vocabulary diff
has been read as a review rather than merged unexamined.
