---
type: Runbook
title: Regenerate the vendored SPDX datasets
description: The hand-run procedure for refreshing @effected/spdx's license-id, exception and metadata literals after an upstream SPDX release.
status: stable
resource: ../../packages/spdx/lib/scripts/generate-data.ts
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5a60ec30e7cfc63e
---

# Regenerate the vendored SPDX datasets

## Trigger

Either of `@effected/spdx`'s two upstream sources has moved: the
`spdx-license-ids` / `spdx-exceptions` npm devDependencies have a new
release, or a new SPDX license-list release should be reflected in
`lib/data/spdx-licenses.json`. Because [the two sources describe the same
license list](../models/spdx-license-data.md), a bump to one is a signal to
check the other in the same pass.

## Steps

1. If `spdx-license-ids` or `spdx-exceptions` is bumping, update the
   devDependency first.
2. If the SPDX license-list has released since the vendored
   `licenseListVersion`, replace `packages/spdx/lib/data/spdx-licenses.json`
   with the new release's published catalog document, in the same commit as
   step 1 — the two sources are clocks that silently diverge otherwise.
3. Run the generator by hand:

   ```bash
   pnpm --filter @effected/spdx exec tsx lib/scripts/generate-data.ts
   ```

   It rewrites only the data literals' contents in
   `src/internal/licenseIds.ts`, `src/internal/exceptions.ts` and
   `src/internal/licenseMeta.ts` by byte span — headers, types and
   co-located hand-authored code are untouched. It reads only the committed
   file and the installed devDependencies; it never fetches over the
   network.
4. Let the generator's own assertions run: every id in the identifier
   catalog must resolve to a metadata entry, and every metadata entry's
   `reference` field must match the templated
   `https://spdx.org/licenses/<id>.html` form. A failure here names the
   offending id — do not relax the assertion to force a pass; fix the input
   data instead.
5. Diff the regenerated literals. Per the kit's oracle-bump discipline, this
   diff is a **catalog review, not a version bump**: read what moved (new
   ids, newly deprecated ids, changed titles or approval flags) rather than
   accepting the diff unread.
6. Run the package's differential-oracle test
   (`packages/spdx/__test__/oracle.int.test.ts`) and the full suite:

   ```bash
   pnpm vitest run packages/spdx
   ```

   If the oracle (`spdx-expression-parse`) and the engine disagree after the
   bump, fix the engine — never pin the oracle back or exclude the
   disagreeing case.
7. Commit the regenerated literals, the updated `lib/data/spdx-licenses.json`
   (if replaced) and any devDependency bump together as one change.

## Observable end state

`src/internal/licenseIds.ts`, `src/internal/exceptions.ts` and
`src/internal/licenseMeta.ts` reflect the current upstream data; the
generator ran to completion with no coverage or template-assertion
failures; `pnpm vitest run packages/spdx` passes, including the
differential-oracle suite at full agreement with `spdx-expression-parse`;
and the diff has been read as a catalog review rather than merged
unexamined.
