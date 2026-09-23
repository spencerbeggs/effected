---
type: Decision
title: "D7: usageExitCode defaults to 64 (BSD EX_USAGE)"
description: A ShowHelp carrying errors remaps to exit 64 by default rather than core's 1, giving a usage error a distinct, greppable code from an ordinary program failure.
status: draft
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T19:35:12Z
  body_sha256: 1536ac5e6c01d2ca76e372931c2a07bebe8a9261c3876a8109c9646841b502b4
---

# D7: `usageExitCode` defaults to 64 (BSD `EX_USAGE`)

## Context

`CliRuntime.reportFailures` never renders a `CliError` `ShowHelp`, because
`Command.runWith` has already printed the help text or the parse error
(`Command.ts:1958-1964` in the vendored `.repos/effect` tree,
`:3094-3100` in the published `node_modules/effect/src` copy, both rc.117); rendering it again produced the stray "Help
requested" line every consumer worked around by hand. That leaves the
exit code question open: a `ShowHelp` that carries errors (a genuine
parse failure — an unknown flag, a missing required argument) still needs
an exit code distinct from 0, and core's own default for an unhandled
`CliError` is 1 — the same code an ordinary runtime failure exits with,
making "the user typed the command wrong" indistinguishable from "the
program crashed" by exit code alone. `chooseExitCode` keeps an error's own
code when it carries one, so this is a choice about what code
`reportFailures` assigns, not a core behaviour being overridden.

## Decision

`ReportFailuresOptions.usageExitCode` remaps a `ShowHelp` that carries
errors to `64`, BSD's conventional `EX_USAGE`, by default. A `ShowHelp`
with no errors (a bare `--help` invocation) keeps exit 0 — it is not a
usage error. A consumer may override `usageExitCode` explicitly if its own
exit-code taxonomy already claims 64 for something else.

## Alternatives rejected

**Core's default of 1.** Rejected as the default specifically because it
collapses two distinguishable situations into one code: a shell script or
CI job branching on "did the user invoke this wrong" versus "did this
crash" cannot tell them apart under a shared code 1, and 64 is a
well-established convention (`sysexits.h`) precisely for this
distinction, already recognizable to anyone who has written a POSIX-ish
CLI.

## Consequences

`okf/modules/cli.md`'s public-surface table documents
`ReportFailuresOptions.usageExitCode` alongside the rest of the
reporting-behaviour changes. `CliRuntime.main`'s own `usageExitCode`
option threads through to the same remap. The design's own numeric-code
policy holds: the kit packages no taxonomy beyond 64 and 130 (the signal-
interrupt code); codes 1 through 3 stay each consumer's own to assign.
A consumer whose exit-code contract already tests for a bare-invocation
`0` and a parse-error `64` — okfit's own ordering names `64` explicitly
— needs no change to adopt this default.
