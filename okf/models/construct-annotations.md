---
type: DataModel
title: construct-annotations.json
description: The intent-keyword sidecar the construct-index generator joins against each package's api-extractor doc model to produce one generated table per kit package.
status: stable
resource: ../../plugins/claude-code/scripts/construct-annotations.json
tags:
  - dx
sources:
  - id: construct-annotations-json
    resource: ../../plugins/claude-code/scripts/construct-annotations.json
  - id: generate-constructs-mts
    resource: ../../plugins/claude-code/scripts/generate-constructs.mts
generated:
  by: "claude-code/sonnet-5"
  at: 2026-09-13T05:33:04Z
  body_sha256: 6d2cd6a67b4da145d9e653eaaf031d1531002bb9276eb970b281ee7e12f5c424
---

# construct-annotations.json

## Overview

The [claude-code-plugin](../modules/claude-code-plugin.md)'s construct
index answers a capability being discoverable only by whoever already
knows its name: one generated table per kit package, listing every
exported construct with an agent-authored **intent** column, under
`plugins/claude-code/skills/effected-packages/references/constructs/<pkg>.md`.
Each row is **construct | kind | purpose | intent keywords**, where
purpose is the TSDoc summary, mechanically extracted, and intent keywords
are the one part a human or agent authors by hand.

## Data model and generator

`plugins/claude-code/scripts/construct-annotations.json` is that
authored sidecar — plain JSON rather than JSONC so the generator needs no
parser dependency — keyed package → construct, holding the intent-keyword
string plus an optional `implements` field.[^construct-annotations-json]
The `implementedBy` side is never authored; the generator derives it by
inverting every `implements` link, so a cross-package contract↔
implementation pair — for example `ActionsIdentityToken` implementing
`sbom.IdentityToken` — renders as an explicit row in both packages' files.

The generator, `plugins/claude-code/scripts/generate-constructs.mts`, is
**dependency-free**: run with bare Node, it parses each package's
api-extractor doc model as plain JSON rather than through
`@microsoft/api-extractor-model`, which is only in the tree transitively
and would need a new devDependency.[^generate-constructs-mts] Its CLI is
`generate` / `check [--require-intent]`, exiting 0 (ok), 1 (annotation
problems) or 2 (missing doc models).

The canonical doc-model input is the package build output,
`packages/<dir>/dist/prod/npm/meta/<dir>.api.json`, produced by `pnpm
build --filter @effected/<dir>` — authoritative on exports, carrying
kind, release tag and TSDoc. The gitignored copies under
`website/lib/models/` are secondary artifacts the generator does not
read, since among other things they can carry stale directories for
packages that no longer exist. The generator enumerates packages by
reading the `packages/` directory on disk — subdirectories containing a
`package.json` — never from a models directory, skipping any package whose
`exports` map holds nothing but `./package.json` (a bin-only package, which
has no import surface and so can never grow a doc model). Rendering is
deterministic: facts from the doc model joined with the annotations.

## Coverage bar

Class, Function and Variable entries **require** an intent annotation —
a missing one is a `check --require-intent` failure naming the
construct. Interface and TypeAlias rows ride on their TSDoc summary
alone, and annotating them is optional. The rationale is that every
documented discoverability miss on record was a value-level capability.

## Enforcement

`plugins/claude-code/__test__/construct-index.bats` pins the index:
fixture tests for the generator, a repo drift test that regenerates the
committed index into a temp dir and diffs it against the committed one,
and the strict `check --require-intent` test. A `setup_file()` hook
self-provisions missing doc models by running `pnpm build`, triggered by
the generator's exit code 2, so CI's auto-discovered shell-test check
needs no custom build step.

## Maintenance

A project-level skill, `.claude/skills/constructs`, documents the
build → check → annotate → regenerate loop. A pull request adding an
export gets a one-row increment, prompted by the failing check.

## Accepted trade-off

The doc-model input adds a build dependency to the check, where a
grep-over-`src` approach would have none — accepted because turbo caching
makes builds cheap, and the doc model eliminates the source-parsing
fragility class and provides TSDoc for free.

## What breaks if an entry is wrong

A missing `intent` on a Class, Function or Variable construct fails
`check --require-intent` by name. A stale or wrong `implements` link
produces a misleading cross-reference in the generated table on both
sides of the pair — the contract side and the implementation side — since
the `implementedBy` inverse is derived rather than independently
checked.

[^construct-annotations-json]: `plugins/claude-code/scripts/construct-annotations.json` —
    package → construct keyed intent strings, with an optional
    `implements` field per entry.
[^generate-constructs-mts]: `plugins/claude-code/scripts/generate-constructs.mts` —
    the dependency-free generator, CLI `generate` / `check [--require-intent]`.
