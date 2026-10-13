---
type: Convention
title: Never undo unexpected working-tree changes with git checkout, restore, or stash
description: Inspect and repair unexpected working-tree changes by hand instead of discarding them, because other agents and earlier automated steps may hold uncommitted work in the same tree.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: a4f3d0f7d1284aba
---

# Never undo unexpected working-tree changes with git checkout, restore, or stash

Never run `git checkout`, `git restore`, or `git stash` to undo unexpected
working-tree changes.[^claude-md] This repository is routinely worked by
more than one agent or automated step against the same checkout, and any of
them may hold genuinely uncommitted work in files that look unexpected from
another vantage point. A blanket discard command cannot distinguish "damage
that should be reverted" from "another agent's in-progress edit" — both
present identically as an unexpected diff.

Always inspect the diff first and repair specifically what is wrong,
leaving everything else untouched. If a change is genuinely unwanted, undo
that change directly (edit the file back, or remove exactly the lines at
fault) rather than reaching for a command that discards everything in the
working tree indiscriminately.

[^claude-md]: `CLAUDE.md` — "Never run `git checkout` / `git restore` /
    `git stash` to undo unexpected working-tree changes — other agents and
    earlier steps hold uncommitted work there. Inspect the diff and repair
    what is actually wrong."
