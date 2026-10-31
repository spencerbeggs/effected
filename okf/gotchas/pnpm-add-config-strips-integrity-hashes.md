---
type: Gotcha
title: pnpm add --config silently strips integrity hashes from every config dependency
description: "Superseded: a configDependencies entry is a plain version, the canonical form, so pnpm add --config writing entries without a +sha512 suffix, and dropping it from the others, loses nothing a consumer is expected to keep; pnpm still honours a suffix that is present."
status: deprecated
resource: ../../pnpm-workspace.yaml
tags:
  - security
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T19:37:34Z
integrity:
  generated:
    body: 4467015ca83c4feb
---

# `pnpm add --config` strips integrity hashes from every config dependency (superseded)

**Superseded.** A `configDependencies` entry is written as a plain version, `"<name>": <version>`, and that is now the canonical form in this repository and in the kit's consumer guidance. pnpm still honours a `+sha512-…` integrity suffix on an entry that carries one, but nothing here asks for one, so the behaviour below no longer costs anything a reader is expected to keep. Do not restore stripped suffixes by hand, and do not add them to new entries.

## What this concept used to warn about

Reproduced on pnpm 11.24.0: `pnpm add --config <package>` wrote the new entry with no `+sha512-…` suffix and removed the suffix from every **other** `configDependencies` entry in the same write, and a later `pnpm install` did not restore them. Under the old guidance, which pinned each config dependency with its integrity hash, that silently removed the guard from the packages with the most reach into an install. The advice was to diff the whole block after every `--config` add and write each hash back from `npm view <name>@<version> dist.integrity`.

## What still holds

The command still rewrites every `configDependencies` entry, not only the one it was asked to add, so read the block's diff after running it. A change there now means a version moved, not a lost hash.
