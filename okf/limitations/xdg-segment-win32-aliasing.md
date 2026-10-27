---
type: Limitation
title: AppDirs.segment does not refuse Windows trailing dots or device names
description: On win32 a segment ending in "." aliases the name without it, and a device name such as CON or NUL names a device rather than a directory; AppDirs.segment refuses neither, because its mapping is a persisted, platform-independent contract.
status: draft
bounds: ../modules/xdg.md
tags:
  - compat
  - security
sources:
  - id: appdirs-source
    resource: ../../packages/xdg/src/AppDirs.ts
  - id: segment-test
    resource: ../../packages/xdg/__test__/AppDirsSegment.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: e3e8067c0c6610c2
---

# AppDirs.segment does not refuse Windows trailing dots or device names

## Condition

A program on Windows passes `AppDirs.segment` a name whose mapping ends in
`.` (`"pkg."`) or is a reserved device name (`CON`, `PRN`, `AUX`, `NUL`,
`COM1`-`COM9`, `LPT1`-`LPT9`, with or without an extension), then joins the
result under an app directory.[^appdirs-source]

## Symptom

`AppDirs.segment` returns `Result.succeed` for each of them. On win32 the
filesystem drops a trailing dot, so `"pkg."` and `"pkg"` resolve to one
directory and two names that the mapping kept apart share state. A device
name opens the device rather than creating a directory, so `mkdir` or a
write under it fails or goes nowhere. On posix both are ordinary names.

## Why it is acceptable

The mapping is a persisted contract: it reproduces vitest-agent's
`normalizeWorkspaceKey` byte for byte, stored data directories are keyed on
its output, and the suite runs a copy of the original as an
oracle.[^segment-test] Refusing or rewriting these names only on win32 would
make the same name map differently by platform; refusing them everywhere
would change an output that existing directories depend on. The mapping is
already documented as not injective (`@org/pkg` and `@org__pkg` share a
segment), and a caller that needs distinct names never to collide is told to
hash the name; the same remedy covers the win32 aliases.

## What a fix would take

A separate, opt-in check (a `win32`-aware validator, or a new segment
function with its own name) that callers adopt for new directories, leaving
`AppDirs.segment`'s output unchanged for existing keys.

[^appdirs-source]: `packages/xdg/src/AppDirs.ts` — `AppDirs.segment` and its TSDoc, which states that neither case is refused so the mapping stays the same on every platform.
[^segment-test]: `packages/xdg/__test__/AppDirsSegment.test.ts` — the oracle comparison against the original normalizer.
