---
type: Limitation
title: The importer-name map carries names only
description: withImporterNames rewrites pnpm workspace package names but leaves their placeholder version untouched.
status: stable
bounds: ../modules/lockfiles.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 1c99fe44582c83f5
---

# The importer-name map carries names only

## Condition

A consumer calls `lockfile.withImporterNames(map)` on a parsed pnpm lockfile to resolve workspace package names from their raw importer-path form to their real manifest names.

## Symptom

After the rewrite, the resolved packages carry their correct real names, but each pnpm workspace package still carries its placeholder version (`"0.0.0"`) rather than the real version from its `package.json`.

## Why this is acceptable

`Lockfile.parse` only has the lockfile text to work from, and a pnpm lockfile names workspace packages by importer path with a placeholder version — the real name and version both live in the corresponding `package.json` files, which this pure package deliberately never reads (see the package's [pure tier posture](../modules/lockfiles.md#tier-and-dependency-posture)). `withImporterNames` was designed to close the naming gap specifically, using a map the consumer builds from manifest IO it already has to perform. Extending the map value to also carry a version was not part of that original need, so the version gap remained.

## What the fix would take

The map value `withImporterNames` accepts can widen from a bare name to a `{ name, version }` pair (or similar), and the rewrite logic would apply both fields instead of just the name. This has not been done because no consumer has needed real versions on rewritten workspace packages yet; the map's shape can widen without a breaking change to today's simpler callers if a consumer's version-carrying map is made an additive alternative input.
