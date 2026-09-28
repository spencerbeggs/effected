---
type: Decision
title: A schemastore outputDir is never exclusively the CLI's
description: schemastore-cli reads only the paths it derives, never a listing of outputDir, because that directory may be shared with another config, a deploy folder, or the repository root — so orphan detection probes derived sibling shapes and knowingly misses a name change.
status: draft
tags:
  - schemastore
  - monorepo
generated:
  by: okfit/claude-code
  at: 2026-09-28T23:39:57Z
  body_sha256: 0ee68c028d4b65efdad62c730d59f117e9af74a8df71135f73b3d09533c7dead
---

# A schemastore outputDir is never exclusively the CLI's

## Context

`schemastore.config.ts` names an `outputDir`, and the CLI derives every path it writes under it. Issue #747 asked `check` to catch the file a rename leaves behind — an `appendVersion` flip, a `name` change or a `layout` change moves a document's derived path, and for a `published` label the old URL keeps serving a stale document with no report. The proposed mechanism, and the first cut of PR #753, listed "the directories the config owns" and reported every unclaimed `*.json` file as orphaned.

## Decision

The CLI never lists `outputDir` (or any directory under it) to decide what is stale. It reads exactly the paths it can derive: the claimed paths, and — for orphan detection — the sibling shapes of each claimed path (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`, `<v>/<name>-<v>.json`) for every label the config still declares. A file at a sibling shape is an orphan; a file anywhere else is invisible to the command.

Any feature that needs "what else is here" — a `name`-change orphan, a dropped-label orphan, a merged catalog across configs — must carry its own ownership record (a per-config identity and a record of what that config wrote), never infer ownership from a directory. The merged catalog (#754) is the first such feature: each config carries a required `name` and owns the slice `<catalogDir>/<name>.json`, and `catalogDir` — a directory that holds only slices by construction — is the one directory the CLI lists.

## Alternatives rejected

**Per-directory ownership** (list each version directory a target or frozen file lands in, plus `outputDir` for flat and unversioned schemas; report every unclaimed `*.json`). Rejected because the premise is false in exactly the layouts a monorepo produces: several configs writing into one `outputDir`, an `outputDir` that is a web host's deploy folder holding a hand-written `manifest.json`, or `outputDir: "."` (legal — `NonEmptyString`). Under that walk `check` for config A exits 1 on config B's documents, or on `package.json`, with a "delete it by hand" remedy — a CI gate that fails on correct trees. It was also too narrow: a `layout` change abandons a directory nothing claims, so the walk never listed it, while the docs advertised the case.

**An ignore list or opt-in "exclusive" flag** on top of the walk. Not taken in #753: an ignore list grows with every schema another config adds, and the opt-in only postpones the false positives to the day a second config appears. If a repository wants an exhaustive audit of a directory it truly owns, that is a separate, explicitly opt-in feature, not the default gate.

## Consequences

- The sibling-shape probe reports nothing on a shared directory that this config could not itself have written, and catches both config-driven renames (`appendVersion`, `layout`) in both directions — one more than the walk did. The one residual false positive is two configs that derive the same `name` and label under different layouts into one `outputDir`: `defineConfig` rejects duplicate paths only within a config, so config A's `<v>/<name>.json` is config B's sibling shape. That is two configs publishing one schema identity to one host — an error in its own right, so no cross-config uniqueness check is added.
- A `name` change and a dropped version label are **not** caught; the old name is unknowable from the config. The docs say so, and the remedy is a hand delete. Closing that gap is a per-config manifest keyed on the config `name` (#754 supplied the identity, not the manifest), not a wider walk.
- Two configs sharing an `outputDir` share the default `catalogDir` and converge on one merged `catalog.json` (#754): each writes only its own slice, and every one of them computes the same union.
