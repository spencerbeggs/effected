---
type: DataModel
title: The committed SPDX license catalog
description: The vendored SPDX license-list document that seeds @effected/spdx's generated metadata table, and what breaks when it falls out of sync with the identifier devDependency.
status: stable
resource: ../../packages/spdx/lib/data/spdx-licenses.json
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: 104eff34dc6077071243dafdfe6267f74771139bf560e0d3fc8a1ccdae8e546c
---

# The committed SPDX license catalog

`lib/data/spdx-licenses.json` is the SPDX workgroup's own published license
catalog, committed into [`@effected/spdx`](../modules/spdx.md) rather than
consumed as a package or a vendored submodule. It is the source for
`src/internal/licenseMeta.ts`, the generated metadata table behind
`License`'s `referenceUrl`, `name`, `osiApproved` and `fsfLibre` getters.

## What an entry holds

The file records `licenseListVersion` (`3.29.0` as vendored) at its top
level, and a `licenses` array of objects, one per SPDX license id, each
carrying at minimum `licenseId`, `name`, `reference` (the canonical
`https://spdx.org/licenses/<id>.html` URL), `isOsiApproved` and
`isFsfLibre`. This is the SPDX workgroup's own schema, unmodified.

## What derives from it

`lib/scripts/generate-data.ts` reads this file and generates
`src/internal/licenseMeta.ts`'s `[id, name, flags]` tuple table — one tuple
per id in the separately-vendored `licenseIds.ts` catalog. The generator
also **asserts** that every entry's `reference` field matches the templated
form `https://spdx.org/licenses/<id>.html`; `License.referenceUrl` is
computed by templating the id at read time rather than by reading a
vendored field, and that assertion is what makes the template a checked
invariant rather than an assumption.

## What breaks if an entry is wrong or missing

This file and the `spdx-license-ids` devDependency (which seeds
`licenseIds.ts`) describe the same license list from two different
upstream sources, and they must be advanced together. If `spdx-license-ids`
adds an id this file does not yet cover, the generator's coverage assertion
— every id in the catalog must resolve to a metadata entry — fails
regeneration loudly, naming the offending id, rather than silently emitting
a table with a hole. Nothing catches a forgotten refresh before that point:
the failure surfaces at the next regeneration, which is the run that would
otherwise ship a `name` of `Option.none()` for every id added since the
last sync.

If the `reference` template assertion is ever relaxed to force a
regeneration through, a real upstream URL-shape change would go unnoticed
and `License.referenceUrl` would compute a link that 404s for the ids that
changed shape.

## Provenance

Committed rather than vendored as a git submodule: the upstream
`spdx/license-list-data` repository is roughly 1.86 GB, and this one file
is 332 KB (300,646 bytes as vendored) — a submodule's sparse configuration
does not travel with a clone, so every clone and every CI checkout would
otherwise pay the full history to reach a rounding error's worth of JSON.
See [the generator-input convention](../conventions/generator-input-is-a-committed-file.md).
The file records its own `licenseListVersion`, which is the provenance
marker a reader checks to know which SPDX release the metadata table
reflects; bumping it is a catalog review (diff the regenerated literals and
read what moved), not a version bump treated as routine.
