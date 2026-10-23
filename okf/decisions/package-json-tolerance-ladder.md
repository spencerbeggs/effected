---
type: Decision
title: package-json reads the same document through five tolerance tiers
description: Package, PackageManifest, LenientManifest, npm's Manifest and the decode-free PackageJsonFormat text path form one strictest-to-most-permissive ladder over the same manifest document, so a caller picks the tolerance its use case actually needs rather than fighting one all-or-nothing decode.
status: stable
tags:
  - architecture
  - dx
sources:
  - id: package-manifest-source
    resource: ../../packages/package-json/src/PackageManifest.ts
  - id: lenient-manifest-source
    resource: ../../packages/package-json/src/LenientManifest.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 580fc8c3f680a8ca
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 9a6549cb2bd05501
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# package-json reads the same document through five tolerance tiers

## Context

A package.json document gets read for very different purposes: publishing
a strict, valid manifest; editing a private workspace root that
legitimately omits `name`/`version`; sniffing a `node_modules` tree or a
fetched tarball where the document is other people's data and one
malformed field must not fail the whole read; resolving `catalog:`/
`workspace:` specifiers mid-build against arbitrary user records; and
reformatting or single-field-editing a manifest that is syntactically
valid JSON but semantically nothing has decoded yet. A single strict
schema cannot serve all five without either rejecting legal input in the
lenient cases or silently accepting garbage in the strict ones.

## Decision

The kit models these as one ladder, strictest to most permissive, over
the same underlying document:

1. **`Package`** — strict, publishable: `name`/`version` required, every
   present field shape-validated against its npm grammar.
2. **`PackageManifest`** — presence-lenient: fields may be absent (the
   private workspace-root shape), but a present field is validated
   exactly as strictly as `Package`'s.[^package-manifest-source]
3. **`LenientManifest`** — shape-lenient discovery/sniffing: a present
   field that fails even its permissive shape check degrades to absence
   rather than failing the whole document, with the degradation recorded
   on `issues`.[^lenient-manifest-source]
4. **`@effected/npm`'s `Manifest`** — shape-blind outside the four
   dependency fields, for mid-build resolution.
5. **`PackageJsonFormat`** — the decode-free text path: anything
   syntactically JSON, no field validation at all.

Each tier relaxes a specific, named axis relative to the one above it
rather than being an independent redesign: `PackageManifest` relaxes
presence of exactly two fields (`name`, `version`) plus the
`packageManager` field's strictness; `LenientManifest` relaxes shape
validation per top-level field, discarding a malformed field into `rest`
rather than failing the document; `Manifest` drops shape validation
entirely outside the four dependency fields; and `PackageJsonFormat`
drops decoding altogether.

## Alternatives rejected

- **One strict schema with an optional "lenient mode" flag.** Rejected
  because a flag would make the return type a union of guarantees hidden
  from both the call site and a reader grepping for which tier a given
  call actually exercises — the same reasoning that keeps the
  decode-free text path a distinctly named entry point rather than a
  `{ strict: false }` option.
- **A single "best effort" decode that silently degrades whatever it
  cannot validate**, with no distinct named tiers at all. Rejected
  because it would make "zero issues" ambiguous between "this document is
  actually valid" and "this document merely didn't hit a check" — the
  ladder keeps that distinction explicit by naming which tier a caller
  chose and what it does and does not verify.
- **Merging `LenientManifest` and `Package`'s presence-lenient tier into
  one class** that is both shape-lenient and presence-lenient at once.
  Rejected because the two lenience axes serve different callers:
  `PackageManifest` is the tier a manifest *editor* works in, expecting
  shape-correct but possibly-incomplete data, while `LenientManifest`
  is a *sniffing* tier for other people's data where shape itself cannot
  be trusted. Collapsing them would force an editor to tolerate malformed
  fields it should instead reject.

## Consequences

A caller picks the tier that matches its actual tolerance need instead
of fighting one all-or-nothing schema — an editor of a private workspace
root uses `PackageManifest`, a tool sniffing published tarballs uses
`LenientManifest`, and a lint or single-field-edit tool uses
`PackageJsonFormat`. The cost is that a reader must know which tier a
given call site is using to know what has actually been validated: an
empty `LenientManifest.issues` array does not imply the document would
pass `Package.decode`, and confusing the two tiers' guarantees is the
one trap the ladder's documentation exists to prevent.

[^package-manifest-source]: `packages/package-json/src/PackageManifest.ts`
    — the presence-lenient tier relaxing exactly `name`, `version` and
    `packageManager`'s strictness relative to `Package`.
[^lenient-manifest-source]: `packages/package-json/src/LenientManifest.ts`
    — the shape-lenient discovery tier, degrading a malformed field to
    `rest` plus a recorded `LenientFieldIssue`.
