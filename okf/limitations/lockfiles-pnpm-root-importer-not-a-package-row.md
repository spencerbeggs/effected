---
type: Limitation
title: The pnpm root importer is not represented as a package row
description: Only non-root pnpm importers become workspace rows in the resolved packages array, so the root importer's own resolution is unrepresented.
status: stable
bounds: ../modules/lockfiles.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e53a27c2c61da327
---

# The pnpm root importer is not represented as a package row

## Condition

A consumer parses a pnpm lockfile and wants a per-importer report of resolved dependencies that includes the workspace root importer (`.`) alongside every other workspace package.

## Symptom

The root importer's own resolution never appears as a row in `Lockfile`'s resolved packages — only non-root importers become workspace rows. A consumer iterating `lockfile.packages` (or the workspace-packages getter) to build a per-importer report will silently omit the root, with no error or indication that anything was skipped.

## Why this is acceptable

This is a direct, documented consequence of how the underlying model represents importers: only non-root importers are materialized as workspace package rows in `packages`, mirroring how pnpm itself treats the root importer differently in its own lockfile structure. Recording the gap here — rather than leaving a downstream consumer to discover it — is the point: a consumer designing a per-importer report needs to design around the root's absence from the start, not discover it as a bug after shipping.

## What the fix would take

Adding a synthesized root-importer row to `packages` would require deciding what identity and resolution data such a row would carry, since the root importer is not itself a resolved package instance the way other workspace packages are — it is the workspace's anchor point, not a dependency target other packages resolve against. No consumer has needed this yet; a consumer that does would motivate the design work to represent it correctly rather than as an ad hoc placeholder.
