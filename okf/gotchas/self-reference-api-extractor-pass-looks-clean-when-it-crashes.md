---
type: Gotcha
title: A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations
description: "Deprecated: @savvy-web/tsdown-plugins 2.10.0 maps a package's own export specifiers to its built declarations in the second API Extractor pass, so images, cli and jsonl no longer hit ae-wrong-input-file-type or a filtered crash; a clean issues.json from that pass is a checked result, and emptying a self-reference suppression pattern brings its warnings back."
status: deprecated
resource: ../../packages/images/dist/prod/issues.json
stale_after: 2027-04-09T00:00:00Z
tags:
  - dx
  - ci
sources:
  - id: issues
    resource: ../../packages/images/dist/prod/issues.json
    title: "Produced by the bundler build, not a file in version control"
  - id: tsdown-plugins
    resource: "npm:@savvy-web/tsdown-plugins@2.10.0"
    title: "meta/api-extractor.js gives the second pass selfReferencePaths, mapping the package's export specifiers to its declaration files"
  - id: jsonl-build
    resource: ../../packages/jsonl/savvy.build.ts
    title: "The node.d.ts ae-forgotten-export suppression the control emptied"
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T21:46:56Z
integrity:
  generated:
    body: 02e4c041e96b76ba
---

# A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations

## Status

Deprecated: the trap is fixed upstream and the kit carries no workaround for
it. `@savvy-web/tsdown-plugins` 2.10.0 gives the second API Extractor pass a
`paths` mapping from the package's own export specifiers to its built
declaration files, so a type-only self-reference such as
`import type * as Jsonl from "@effected/jsonl"` resolves to declarations, not
to `src`.[^tsdown-plugins] A forced build of `images` reports 0 warnings and no
`ae-wrong-input-file-type`.[^issues] `cli` and `jsonl` report coded warnings
from their second passes, so those passes run to completion. Emptying the
`node.d.ts` suppression pattern in `jsonl` brings back 28 coded
`ae-forgotten-export` warnings against `node.d.ts`, and restoring it returns
the build to 0.[^jsonl-build]

## What still holds

The second pass still reports every root type a self-referencing entry names
as `ae-forgotten-export` against that entry, which is why `images`, `cli` and
`jsonl` each keep one narrow suppression scoped to their non-root entry
points (`cli` covers two: `./ui` and `./ui/testing`).
That suppression is checked: a clean `issues.json` from the second pass is a
real result, not an unchecked one.

## What to do

Nothing. If a second entry point's `issues.json` stays clean while its
suppression pattern is emptied, the pass has stopped running again: re-check
the bundler before trusting the gate.

[^issues]: `packages/images/dist/prod/issues.json`, produced by the bundler
    build, not a file in version control.
[^tsdown-plugins]: `npm:@savvy-web/tsdown-plugins@2.10.0`, `meta/api-extractor.js`.
[^jsonl-build]: `packages/jsonl/savvy.build.ts`, the `node.d.ts`
    `ae-forgotten-export` suppression.
