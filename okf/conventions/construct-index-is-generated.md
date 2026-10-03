---
type: Convention
title: Never hand-edit the construct index — regenerate it
description: The construct-index tables under plugin/skills/effected-packages/references/constructs/ and their copies in plugin/builds/ are generated output; edit construct-annotations.json, rerun the generator and rebuild instead of touching a table directly.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
sources:
  - id: generate-constructs-mts
    resource: ../../plugin/scripts/generate-constructs.mts
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T04:19:44Z
  body_sha256: 944b4d04fb0e039cb2a3af475ac5bcf2f73b38953da54a2fc56f4f06a59c9b10
---

# Never hand-edit the construct index — regenerate it

The tables under
`plugin/skills/effected-packages/references/constructs/<pkg>.md`
are generated output, joined from each package's api-extractor doc model
and the authored intent annotations in
[construct-annotations.json](../models/construct-annotations.md). Never
edit one of these tables by hand: the next regeneration silently
overwrites it, and a hand-edit that adds an intent string or a
cross-reference outside the annotations sidecar has nowhere durable to
live.

To change what the index says:

1. Build the target package if its doc model is missing or stale: `pnpm
   build --filter @effected/<pkg>`.
2. Edit the intent keywords or `implements` link in
   `plugin/scripts/construct-annotations.json`.
3. Regenerate with bare Node, naming the packages you changed:
   `node plugin/scripts/generate-constructs.mts generate
   --only <pkg,...>`. `--only` leaves every other table byte-identical,
   so a stale local build of an unrelated package cannot rewrite its
   rows. A bare `generate` reads every package's model and exits 3,
   naming the package, when any model is older than its `src/`; rebuild
   that package, or add `--force` to the build if turbo replayed a cache
   hit onto an unchanged model.
4. Confirm coverage with `... check --require-intent`, which fails
   naming any Class, Function or Variable construct still missing an
   intent annotation.
5. Rebuild the plugin with `pnpm build --filter @effected/ai-plugin`,
   which copies the regenerated tables into both committed builds under
   `plugin/builds/`, and commit the source and builds together.

`plugin/__test__/construct-index.bats`'s drift test
regenerates the committed index into a temp directory and diffs it
against the committed one — a hand-edit that has drifted from what the
generator would produce fails that test rather than merging quietly.
