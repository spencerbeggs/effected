---
type: Decision
title: CliLinks finds the project root with @effected/walker
description: "CliLinks locates the nearest ancestor holding .git or pnpm-workspace.yaml with Walker.ascend and Walker.findRoot, taking @effected/walker as a required peer of @effected/cli, rather than a hand-written ascent."
status: stable
supersedes: cli-links-inline-ascent.md
tags: [architecture, deps]
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T23:56:58Z
  body_sha256: fce59e2454cf60bdd33087dee1957d93a05e29802991eb0890899a334c604ce5
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# CliLinks finds the project root with @effected/walker

## Context

`CliLinks` decides whether file links open in an editor, and for that it finds
the project root (the nearest ancestor of the working directory holding `.git`
or `pnpm-workspace.yaml`) and checks for a `.vscode/` directory there. The
[first draft](cli-links-inline-ascent.md) wrote that walk inline, to keep
`@effected/walker` out of `@effected/cli`'s peers: walker peers on
`@effected/glob`, and that looked like two extra installs for every consumer.

## Decision

`CliLinks` takes the `@effected/walker` edge and uses `Walker.ascend`, bounded
to the working directory and at most 64 ancestors, with `Walker.findRoot` for
the marker test. `@effected/walker` is a required `workspace:^` peer of
`@effected/cli` and a `workspace:*` devDependency. Every workspace consumer of
`@effected/cli` declares walker, and `@effected/glob`, which walker peers on,
beside it: `schemastore-cli` as regular dependencies, `scratchpad` already
lists both. The layer order allows it: `cli` is above `walker`.

The reasons:

- The kit is designed to interlock, and walker exists for exactly this upward
  walk. The real consumers of `cli` (okfit, vitest-agent) already depend on
  walker and glob, so the install cost the first draft feared is close to
  nothing.
- Walker has the hardened semantics the hand-written loop lacked: a bounded
  chain, a `dirname` fixpoint guard, and a per-directory probe whose failure is
  treated as "not a root", so one unreadable directory never hides a root above
  it.

## Alternatives rejected

- **An inline ascent.** Rejected: it duplicates walker's hardened ceiling
  semantics, and the consumers already carry walker and glob.
- **Make walker an optional peer.** Rejected: an optional peer reached from a
  module the root imports is a crash for consumers who skipped it.

## Consequences

The edge is one-way and downward. A consumer of `@effected/cli` now installs
walker and glob. Tier rules still hold: no integrated or platform-bound package
is pulled into `cli`. The ascent stays behind one function in `CliLinks`, so the
walk can change without touching the link policy.
