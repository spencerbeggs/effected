---
type: Gotcha
title: Vendored repos are empty on a fresh clone
description: A fresh clone, CI runner or new git worktree starts with an empty .repos/ checkout, even though .gitmodules and .repos/config.json name every vendored repo.
status: stable
resource: ../../.repos/config.json
stale_after: 2027-03-13T00:00:00Z
tags:
  - ci
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 3a4c9c8a6247fd5e
---

# Vendored repos are empty on a fresh clone

## What a reader sees

`.gitmodules` and `.repos/config.json` both list `.repos/effect` and its siblings with real URLs, refs and sparse paths. Reading either file looks exactly like confirmation that vendored Effect v4 source is available to read on disk right now.

## What they wrongly conclude

That `.repos/effect/packages/effect/src` (or any other listed path) already holds checked-out content, because the manifest describing it is present and correct.

## What is actually true

Git submodule content is never stored in the parent repository's tree — only the gitlink (a pointer to a commit in the submodule) is. A fresh `git clone`, a new CI runner checkout, or a newly created git worktree therefore starts with an **empty** `.repos/` directory structure: the directories may exist but hold no files. A GitHub tarball download never contains submodule content at all, under any circumstance. Trying to read `.repos/effect/packages/effect/src/...` in this state fails or returns nothing, which can be misread as "the sparse checkout excludes this path" rather than "nothing has been synced yet".

## The check

Run `savvy repos sync` (or invoke the `repos_manage` MCP tool with `action:"sync"`) once per fresh clone, CI runner, or new worktree before relying on any vendored content — see [sync the vendored repos](../runbooks/sync-vendored-repos.md). Confirm with `savvy repos status` (or `repos_inspect` with `mode:"status"`) that the expected sparse paths are actually materialized before citing anything under `.repos/` as evidence.
