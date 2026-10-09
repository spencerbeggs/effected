---
type: Decision
title: "cli sets the exit code through core's own Runtime markers"
description: Why CliRuntime.reportFailures reads and writes Runtime.errorExitCode / Runtime.errorReported instead of touching process.exitCode.
status: stable
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 603a9476d847d8f0894d899d85f9790fff2bc440e783706ec20c7b03df8e49d5
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# cli sets the exit code through core's own Runtime markers

## Context

`@effected/cli` needs a program's failure to set a specific process exit
code and to be reported exactly once, in the program's own logger's format,
rather than in Effect's default logger's format on stdout. Core exposes two
markers read off the squashed failure by `defaultTeardown` /
`makeRunMain`: `Runtime.errorExitCode`, a readonly property on an error
class giving the process exit code for that failure, and
`Runtime.errorReported`, which controls whether the runtime logs the
failure itself.

`Runtime.getErrorExitCode` already returns `1` for an unmarked error, so
`getErrorExitCode(e) ?? 1` is dead code, and reading it alone cannot tell an
error deliberately marked `1` apart from an unmarked one — which matters the
moment an `exitCode` option exists to override the second case but not the
first.

## Decision

Test for the marker explicitly (`Runtime.errorExitCode in error`), then
read it, rather than trusting `getErrorExitCode`'s fallback. `CliRuntime.
reportFailures` renders the failure through the program's own logger and
re-fails with an error carrying both markers: the exit code it wants, and
`errorReported` set to suppress the runtime's own duplicate report.

The `errorReported` polarity is inverted from its name: setting it to
`false` suppresses the runtime log ("already reported"); omitted or
non-boolean is treated as `true`, and the failure is logged. A reader who
assumes `errorReported: true` means "I reported it, stay quiet" gets exactly
the double-report this package exists to prevent — the test for this rule
is written so that flipping the source value fails, not so that it merely
records the current one.

## Alternatives rejected

- **`process.exitCode`, set directly by the consumer.** Rejected because it
  is platform-specific (a Node global) and defeats the whole point of a
  platform-free presentation package.
- **`getErrorExitCode(e) ?? 1` as the sole read.** Rejected because it
  cannot distinguish a deliberately-marked `1` from an unmarked default,
  which breaks the moment an `exitCode` override needs to apply to one case
  and not the other.

## Consequences

A consumer never has to set the exit code itself: `CliRuntime.
reportFailures` is a complete answer, applied inside the program before
`runMain` is called. Any future change to how `errorReported`'s polarity is
read must keep the inverted-polarity test, or the double-report regression
this package exists to prevent returns silently.
