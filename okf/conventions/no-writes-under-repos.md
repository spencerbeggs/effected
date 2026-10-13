---
type: Convention
title: Never write under .repos/
description: .repos/ holds read-only vendored reference source; use the repos management tooling instead of Write, Edit, Bash, or any MCP git operation against it, and never expect it in a build or lint graph.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - architecture
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c67baf056fdfce50
---

# Never write under .repos/

`.repos/effect` and its sibling submodules are read-only vendored reference
source: `.repos/effect` is the authority on what Effect v4 actually exports,
and the sibling submodules vendor spec inputs (the CommonMark/mdast set)
for specific packages.[^claude-md] Never write to anything under `.repos/`
— this is hook-enforced, not merely a style preference: a `PreToolUse`
guard denies `Write`, `Edit`, `Bash`, and MCP-git mutations targeting the
tree, so a direct edit attempt fails at the tool boundary rather than
landing and needing to be caught in review.

Use the repos management tooling (`repos_manage`, or `savvy repos` on the
command line) for anything that looks like it needs a change under
`.repos/` — syncing, re-pinning, or otherwise updating vendored content
goes through that path, never through a raw filesystem write. The tree also
sits outside every build and lint graph in this repository: nothing under
`.repos/` is compiled, bundled, or linted as part of this workspace, which
is consistent with its role as reference material to read rather than code
this repository owns.

[^claude-md]: `CLAUDE.md` — "Repository Layout": "`.repos/effect` — ...
    **Never write to anything under `.repos/`** — silk's PreToolUse guards
    deny it."
