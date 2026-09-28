---
type: Limitation
title: "@effected/cli is not a CLI framework"
description: The package deliberately carries no argument parsing, no platform package, and no interactive terminal UI.
status: stable
bounds: ../modules/cli.md
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 465a1831be713ee1eb863d9b9b360d2a53d578e1dc188624851e1d5b67f97d93
---

# @effected/cli is not a CLI framework

## The condition

A consumer wants argument parsing, flags, a command tree, help rendering, a
platform dependency, or interactive terminal UI (prompts, spinners,
progress bars) from `@effected/cli`.

## The symptom

None of that surface exists in this package, and it will not be added
there even when a change starts to look like it belongs. `effect/cli`
already owns argument parsing, flags, the command tree and the help
system; `Prompt` already exists in core's CLI namespace for interactive
input.

## Why this is acceptable

`@effected/cli` is boundary tier and scoped narrowly to presentation: how
output reaches a human, how a failure is reported, and how a schema issue
renders into a sentence. Adding a parser or an interactive-UI dependency
would move it off that scope and, in the platform-package case, would make
the package unusable from Bun or Deno for no benefit — the moment
`@effect/platform-node` appears here, that guarantee is gone. The package
also enforces that nothing in the kit may depend on it except an
application, so widening its surface would widen what every application is
forced to carry.

## What the fix would take

Nothing to fix inside this package: a consumer reaches for
`effect/cli`'s own parsing and command-tree constructs directly,
and for `Prompt` for interactive input. If a change here starts to look
like parsing, it belongs upstream in core or nowhere. Colour-aware output
is the one open question recorded as deferred rather than rejected —
`Stdio.stdoutIsTerminal` makes a TTY-aware palette expressible, but colour
in a logger and colour in rendered output are different problems, and only
the second is clearly in scope; it is deferred until a consumer asks.
