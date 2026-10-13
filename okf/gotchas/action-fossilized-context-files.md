---
type: Gotcha
title: A CLAUDE.md that reads confidently can be citing a tree that no longer exists
description: An action repository's context files kept naming deleted workflows, renamed config files, absent directories and superseded tools long after the repository itself had moved on — nothing about reading the file signals that its claims are stale.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d10f51785c760ff8
---

# A CLAUDE.md that reads confidently can be citing a tree that no longer exists

## What a reader sees

A repository's root, `src/`, or `__test__/` `CLAUDE.md` states specific
file paths, workflow names, config file names, or a "behavioural oracle"
directory as fact, written in the same confident, declarative style as
everything else in the file.

## What they would wrongly conclude

That every specific claim in the file is still true of the current tree,
because nothing in the file's tone or formatting distinguishes a durable
fact from one that quietly stopped being true months ago.

## What is actually true

One audited action's `src/CLAUDE.md` directed an agent to a documentation
directory as the behavioral oracle for roughly 80 numbered citations in
source — a tree that no longer existed in the repository at all. Across
the three audited actions, root `CLAUDE.md` files named deleted workflows,
renamed configuration files, absent directories, and superseded tooling
that had all moved on since the file was last touched. None of this
produces a build error or a test failure; a context file is prose, and
prose does not fail to compile when the tree it describes changes under
it.

## The check

Treat every kit-version bump, and every definition-of-done for a design
change, as an occasion to re-verify every specific claim a context file
makes — file names, workflow names, script names, counts, and directory
references — against the current tree, not to assume the file is current
because nothing flagged it. Write context files in a post-mortem shape so
a stale claim is easier to spot: name the incident, the wrong explanation
believed first, and the guard, so a reader can tell a load-bearing fact
from incidental narration and re-derive a count or version rather than
cite it as fixed.
