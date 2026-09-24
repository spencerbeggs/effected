---
type: Interface
title: Vendored repos manifest
description: The .repos/config.json shape the silk repos tooling reads to manage every vendored submodule.
status: stable
kind: config
resource: ../../.repos/config.json
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 60212e1ec00ffbca600e20e3f7865feb1a74cf655f3cbd12b831ad514bd37106
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:22.388Z
---

# Vendored repos manifest

## What stays stable

`.repos/config.json` is a JSON document with one top-level `repos` object, keyed by the submodule's directory name under `.repos/` (for example `effect`, `commonmark-js`, `mdast`). The silk plugin's repos tooling (`savvy repos ...` CLI and the `repos_inspect` / `repos_manage` MCP tools) reads and writes this file rather than any consumer reading `.gitmodules` directly, and it is the single source of truth for what is vendored, why, and how much of it is checked out.

Each entry carries:

- **`url`** — the upstream git remote.
- **`ref`** — the pinned ref, either a tag (`effect@4.0.0-rc.115`, `0.31.2`) or in principle a branch; for `.repos/effect` this is always a release tag matching the `effect` pnpm catalog pin, never `main` (see [vendored Effect is pinned to the catalog tag](../decisions/vendored-effect-pinned-to-catalog-tag.md)).
- **`purpose`** — one paragraph stating why the repo is vendored and what it is an authority or port base for.
- **`sparse`** — an array of paths materialized by the sparse checkout; an entry may omit this to mean a full checkout (`mdast`, and the MDX oracle repos, have no `sparse` key).
- **`orientation`** — an object with `layout` (prose describing what is under each sparse path), `keyPaths` (a map of short names to paths worth starting from) and `startHere` (prose pointing a reader at the single most useful file or directory first).
- **`notes`** — an optional array of dated entries (`id`, `date`, `ref`, `note`) recording findings tied to a specific pinned ref; a re-pin can flag existing notes as `staleNoteIds` when they were stamped against an older ref, which is the tooling's cue that a note may need re-verifying or retiring.

Only this manifest is legitimately editable by hand (notes, orientation, sparse paths) — the vendored content it describes is read-only, enforced by the silk plugin's PreToolUse guards under `.repos/**`. See [the workspace module](../modules/workspace.md#vendored-source) for how the manifest fits into the repo's build and lint exclusions.

## What is not promised

The manifest does not promise that any entry's content is present on disk at a given moment — a fresh clone, CI runner or new worktree starts with every entry's sparse paths empty regardless of what the manifest lists (see [vendored repos are empty on a fresh clone](../gotchas/vendored-repos-empty-on-fresh-clone.md)). Consult `savvy repos status` / `repos_inspect mode:"status"` for actual checkout state, not this file.
