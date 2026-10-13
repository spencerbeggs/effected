---
type: Convention
title: Agents never run pnpm:up, pnpm:preview, or pnpm:export
description: The three commands that advance and export the Effect catalogs mutate the lockfile and root pnpm-workspace.yaml and are reserved for the user to run; agents surface the command instead. catalog:check and catalog:sync are a different, agent-safe class.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - release
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: ba8f14d35475b82a
---

# Agents never run pnpm:up, pnpm:preview, or pnpm:export

`pnpm pnpm:up`, `pnpm pnpm:preview`, and `pnpm pnpm:export` advance and
export the Effect catalogs, and each mutates the lockfile and the root
`pnpm-workspace.yaml`.[^claude-md] Agents must not invoke any of the three;
when advancing the Effect pin is the right next step, surface the command
to the user and let them run it — the sequence is `pnpm:up` followed by
`pnpm:export`.

`pnpm catalog:check` and `pnpm catalog:sync` are a different class of
command and agents may run both: `catalog:check` is a read-only drift gate,
and `catalog:sync` writes nothing beyond
`packages/pnpm-plugin-effect/savvy.build.ts` and one fixed-name changeset.
Both exist to keep the published `effected` catalog current for external
consumers, and neither should be grouped with the user-run `pnpm:*` class
merely because the names look similar.

[^claude-md]: `CLAUDE.md` — "Commands": "User-run only" for the three
    `pnpm:*` commands, and "Agents may run" for `catalog:check` /
    `catalog:sync`.
