---
type: Invariant
title: ActionEnvironment is the only reader of ambient process state
description: "In @effected/github-actions, process.env, process.arch and process.platform are read once, at ActionEnvironment's layer construction; every other read site is a caller-overridable default on a closed allowlist that __test__/ambientReads.test.ts scans src for and names on any new site."
status: stable
resource: ../../packages/github-actions/__test__/ambientReads.test.ts
tags:
  - testing
  - architecture
sources:
  - id: ambient-reads-test
    resource: ../../packages/github-actions/__test__/ambientReads.test.ts
  - id: action-environment
    resource: ../../packages/github-actions/src/ActionEnvironment.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 22862c66bc5d9d71
---

# ActionEnvironment is the only reader of ambient process state

## The property

`ActionEnvironment` reads `process.env` **once**, at layer construction,
into an immutable map held in a `Context.Reference`, and nothing in
[`github-actions`](../modules/github-actions.md) mutates it
afterwards.[^action-environment] Every other `process.env`,
`process.arch` or `process.platform` read in `src/` is a **defaulted
parameter a caller overrides**, never a read behind the caller's back:
`ActionInput.provider`'s ambient provider, `DetachedProcess.spawn`'s
`base` environment, the runner-arch and host-libc fallbacks in
`ToolInstaller`, `PackageManagerInstaller` and `internal/pnpmExe.ts`,
and `ToolInstaller.makeTest`. `ChildEnv` reads nothing ambient at all —
its `base` and `platform` are required arguments — and its class doc
states the rule.

Two consequences follow. `ActionEnvironment.withEnv` is fiber-local and
parallel-safe, because an override seeds a scoped copy of the map rather
than touching the process. And a variable exported mid-run (by
`exportVariable`, or by a child process) is **not** observed by an
already-seeded reader — the correct trade, since GitHub's own model
targets *subsequent* steps with an exported variable.

## Why it must hold

A second reader of `process.env` is a second source of truth. The
incident that motivated the rule found duplicate `GITHUB_SHA` reads with
divergent fallbacks, so which fallback won depended on which code path
ran first — see
[the env-shadowing gotcha](../gotchas/action-r-channel-erasure-and-env-shadowing.md).
A hand-rolled set/restore around `process.env`, which the package this
one replaced used for overrides, is not parallel-safe and admitted as
much in a comment.

## The mechanism

`__test__/ambientReads.test.ts` walks every `.ts` file under `src/`,
tokenizes it (string literals and comments are skipped, so prose
mentioning `process.env` never matches), and collects every
`process.env` / `process.arch` / `process.platform` token triple. Each
site must appear on an allowlist keyed on **file and line text** — not
line number, so an edit above a sanctioned site does not move it off the
list — and every allowlist entry carries a stated reason. An unlisted
site fails the suite naming the file and line; a listed site that no
longer exists fails too, so the list cannot grow stale in either
direction.[^ambient-reads-test]

## What would break it

Adding a `process.env` read anywhere in `src/` without adding it to the
allowlist with its reason, or widening the allowlist to admit a read that
is not a caller-overridable default. A new sanctioned default belongs on
the list; a new *reader* of the environment belongs in
`ActionEnvironment`.

[^ambient-reads-test]: `packages/github-actions/__test__/ambientReads.test.ts`
    — the tokenizing scanner, the `(file, line text)`-keyed allowlist with
    a reason per entry, and the two assertions (no unsanctioned site; every
    sanctioned site still present).
[^action-environment]: `packages/github-actions/src/ActionEnvironment.ts`
    — the layer that snapshots `process.env` into a `Context.Reference` at
    construction, and `withEnv`'s scoped override over that map.
