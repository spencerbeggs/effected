---
type: Decision
title: A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt
description: Walker.ascendWithin bounds the upward walk by a symlink-resolved ceiling as its own static, so ascend's R stays Path alone, and takes the ceiling as an Option so a stray undefined cannot request an unbounded walk.
status: stable
tags:
  - architecture
sources:
  - id: walker-source
    resource: ../../packages/walker/src/Walker.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-29T06:16:45Z
  body_sha256: be6b99169429f34acc758c0fe7a6e4386fc9335811974401e0aaa2d15976b89f
verified:
  - by: human:spencer
    at: 2026-09-29T06:17:45Z
---

# A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt

## Context

`Walker.ascend`'s `stopAt` is compared lexically, in resolved form on
both sides ([the ascend ceiling fails
closed](ascend-ceiling-fails-closed.md)). `Git.repoRoot` answers a
**physical** path — git resolves symlinks — so when the start directory
is reached through a symlink (every macOS tmpdir: `/var` is
`/private/var`; any symlinked checkout) the lexical chain never spells
git's root, the ceiling never matches, and the ascent runs to the
filesystem root: the same fail-open class the earlier Decision closed,
through a different door. The need surfaced in the vitest-agent
`git-common-dir` dogfood loop, whose config walk-up is bounded by the git
root.[^walker-source]

## Decision

The physical ceiling is a separate static, `Walker.ascendWithin(start,
ceiling, options?)`, and `ascend` is unchanged. It yields `ascend`'s
lexical chain and changes only the stopping test: the nearest ancestor
whose `realPath` equals the ceiling's `realPath`, inclusive. A ceiling
the chain already spells stops with no I/O; a failed `realPath` probe on
an ancestor is absorbed as "not the ceiling", and an unresolvable ceiling
leaves the lexical answer standing. A present relative ceiling dies, for
the reasons the earlier Decision gives.

The ceiling is an `Option<string>`, not `string | undefined`.
`Option.none()` is exactly `ascend(start)` — the natural answer outside
any repository, spelled `Walker.ascendWithin(start, yield*
Effect.option(git.repoRoot(start)))` — and it is the only way to ask for
an unbounded walk, so an accidentally-undefined ceiling cannot become one.

## Alternatives rejected

- **Make `stopAt` compare by realpath.** Rejected: it adds `FileSystem`
  to `ascend`'s `R`, breaking every caller that provides only `Path` —
  [config-file](../modules/config-file.md)'s resolvers among them — for a
  guarantee only callers holding a physical ceiling need.
- **Take the ceiling as `string | undefined`.** Rejected: a stray
  `undefined` from an unwired lookup would silently request the unbounded
  walk the ceiling exists to prevent.
- **Canonicalize the ceiling in `@effected/git`.** Rejected there for the
  mirror reason: it would add `FileSystem` to `Git.layer`'s `R`. Git
  already returns the physical path; the walker side is where the chain
  meets it.

## Consequences

`AscendOptions.stopAt`'s TSDoc warns that it is lexical and points at
`ascendWithin`; [walker](../modules/walker.md) and
[git](../modules/git.md) state the pairing from both sides. Never fold
the physical test back into `stopAt` without first moving every
`Path`-only caller.

[^walker-source]: `packages/walker/src/Walker.ts` — `ascendWithin` and
    its private `ascendToPhysical`, plus the `AscendOptions.stopAt`
    TSDoc warning.
