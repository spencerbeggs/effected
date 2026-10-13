---
type: Limitation
title: A package manifest cannot say who supplied it, who assembled the BOM, or when
description: SbomMetadataSource refuses to fabricate supplier, BOM-author and timestamp fields a package.json cannot honestly answer.
status: stable
bounds: ../modules/sbom.md
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: feb2bb797da65bbb
---

# A package manifest cannot say who supplied it, who assembled the BOM, or when

## Condition

`SbomMetadataSource` (`packages/sbom/src/SbomMetadataSource.ts`) derives
CycloneDX component and metadata fields from a `package.json` manifest.
Three of the NTIA minimum elements — supplier, BOM authors, and the
generation timestamp — have no honest source inside a manifest: a
`package.json` says who wrote the software (`author`, `maintainers`), but
never which organization supplied the published artifact, who assembled
this particular SBOM, or when the SBOM was generated.

## Symptom

A caller that expects `SbomMetadataSource.fromPackage` to populate
supplier, BOM authors, or a timestamp from the manifest alone finds those
fields absent from the derived metadata, even though the manifest is
otherwise complete. The `NtiaReport` for a document assembled from
manifest-only metadata will report those three elements as missing unless
the caller supplies them explicitly.

## Why this is acceptable

Deriving any of the three would be fabrication, not derivation: a
manifest's `author` field answers "who wrote this software", not "which
organization is publishing this build" or "who ran the tool that produced
this SBOM right now". `SbomMetadataSource` treats all three as
**explicit-only** inputs — the caller must supply them — rather than
guessing at a plausible default that would be wrong exactly when it
matters (a fork, a rebrand, an internally repackaged build). Publisher
resolution is the one related field that *is* derived, through an
explicit-then-supplier-then-author fallback chain, because that chain
keeps the publisher element satisfiable from a manifest alone without
inventing a fact the manifest does not state.

The same discipline extends to two related fields covered by
[`NtiaReport` as a report, not a gate](../decisions/ntia-report-not-a-gate.md):
the copyright formatter takes the year as an **argument** rather than
reading the ambient clock, because defaulting to the current year would
make the output untestable and the purity claim false; and an
unrecognized `repository` field emits **no** VCS external reference at
all, since an external reference's URL field is a URL, and passing
`owner/name` through unchanged would validate against the schema while
misleading a verifier.

## What the fix would take

There is no fix within this package's scope, because the missing data is
not derivable from a `package.json` by definition — no parsing
improvement or heuristic recovers information the source document does
not contain. A caller that wants these three elements populated supplies
them explicitly to `SbomMetadataSource`'s merge step (which is
field-wise, with no precedence opinion of its own — which side is the
override is release policy the consumer's own configuration expresses),
typically from CI environment context (an organization identity, a build
identity, the generation instant) rather than from the manifest.
