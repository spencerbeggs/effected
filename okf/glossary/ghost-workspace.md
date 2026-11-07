---
type: Glossary
title: Ghost workspace
description: A pnpm workspace member that is real to the tooling but excluded from release, CI and coverage — committed shell, gitignored working areas.
status: stable
tags:
  - dx
sources:
  - id: scratchpad-claude-md
    resource: ../../scratchpad/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T19:10:31Z
integrity:
  generated:
    body: f9f9de640d550fdc
---

# Ghost workspace

A **ghost workspace** in this repository is a pnpm workspace member that
the tooling treats as fully real — `workspace:*` dependencies resolve,
turbo and vitest-agent see it as an ordinary project — while being
deliberately excluded from the paths that matter for a shippable package:
it is never versioned by changesets, never built with `effected package build`,
never counted toward release scope, and its tests never gate CI.

[scratchpad](../modules/scratchpad.md) is the repository's one instance.
It earns "ghost" status through three simultaneous exclusions: it is
listed in the `ignore` array of `.changeset/config.json`, it is skipped
by the vitest discover strategy whenever the `CI` environment variable is
set, and its directory sits in the root coverage `exclude` list. None of
those exclusions alone would justify the term — a package can be
`ignore`d by changesets without being a ghost — the term names the
*combination*, a member that is structurally present but functionally
invisible everywhere except local development.

The distinction that matters in practice: the workspace's **committed
shell** (`package.json`, `tsconfig.json`, `CLAUDE.md`, `lib/`,
`__test__/utils/`) is real, reviewed content held to the repository's
ordinary quality bar, while its **working areas** (`probes/`,
`__test__/*.test.ts`) are gitignored and disposable, reseeded from
templates on every reset. Reading "ghost" as "nothing here is real" is
the trap: only the working areas are ephemeral, and mistaking a
committed file for a scratch file — or vice versa — is exactly the
mistake the term exists to prevent.
