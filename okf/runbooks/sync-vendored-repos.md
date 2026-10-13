---
type: Runbook
title: Sync the vendored repos
description: Materialize the .repos/ submodules' sparse checkouts on a fresh clone, worktree, or CI runner.
status: stable
tags:
  - ci
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c9a00ac54ca095f5
---

# Sync the vendored repos

## Trigger

A fresh `git clone`, a newly created git worktree, or a CI runner needs to read anything under `.repos/` (most commonly `.repos/effect` for Effect v4 source) and the directory's sparse paths are empty — the expected starting state, per [vendored repos are empty on a fresh clone](../gotchas/vendored-repos-empty-on-fresh-clone.md).

## Steps

1. Run `savvy repos sync` (or invoke the `repos_manage` MCP tool with `action:"sync"`).
2. Confirm materialization with `savvy repos status` (or `repos_inspect` with `mode:"status"`), checking that the expected sparse paths listed in `.repos/config.json` for each repo actually exist on disk.
3. If a specific repo still reads empty after a sync, check whether its entry in `.repos/config.json` lists the path under `sparse` at all — an unlisted path is never materialized regardless of sync state.

## Observable end state

Every vendored repo's `sparse` paths from `.repos/config.json` are present and readable on disk (`.repos/effect/packages/effect/src` in particular), and `savvy repos status` reports a clean, synced tree with no pending sync action.
