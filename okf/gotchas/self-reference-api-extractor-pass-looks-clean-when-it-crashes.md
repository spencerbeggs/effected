---
type: Gotcha
title: A package that names its own root types shows one warning or none, depending on whether the second pass crashes
description: "The second API Extractor pass resolves the package self-reference into src; images reports one ae-wrong-input-file-type, while cli and jsonl crash on an uncoded warning the ae-/tsdoc- filter drops, so they look clean."
status: draft
resource: ../../packages/images/dist/prod/issues.json
stale_after: 2027-04-09T00:00:00Z
tags:
  - dx
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T16:03:02Z
  body_sha256: a81d40af12dd3a51552b52e076ef16ff0ffd2cfb234f62be39c7d579cffdfe72
---

# A package that names its own root types shows one warning or none, depending on whether the second pass crashes

## What a reader sees

`packages/images/dist/prod/issues.json` carries one `ae-wrong-input-file-type` warning after a clean build, while `cli` and `jsonl` show nothing for the same construct.[^issues]

## What they wrongly conclude

That `images` did something the other two avoided, or that `cli` and `jsonl` are clean and `images` is the outlier to fix.

## What is actually true

All three packages use the same pattern from [the images module](../modules/images.md): cache-side modules name root types through a type-only `import type * as Images from "@effected/images"` and import runtime values relatively. The second API Extractor pass in `@savvy-web/tsdown-plugins` resolves that package self-reference into `src/*.ts`, which API Extractor rejects as the wrong input file type. In `images` the pass finishes and reports one coded warning. In `cli` and `jsonl` the same resolution makes the pass crash with an uncoded warning, and the `ae-` and `tsdoc-` filter drops it, so their `issues.json` looks clean without having been checked. The defect is upstream in the bundler plugin; do not add a suppression in any package, and treat a clean `cli` or `jsonl` gate as unproven for self-referencing types. Remove this concept when the plugin resolves a self-reference to its built declarations.

[^issues]: `packages/images/dist/prod/issues.json`, produced by the bundler build, not a file in version control.
