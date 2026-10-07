---
type: Module
title: "@effected/github-commands"
description: "The GitHub Actions workflow-command grammar as pure functions: render a command, and neutralize text so the runner cannot read it as one."
status: draft
kind: package
resource: ../../packages/github-commands
tags: [github, security, bundle]
generated:
  by: okfit/claude-code
  at: 2026-10-07T21:32:23Z
  body_sha256: df63a018601200d8bd225c7ef6b39ab3a3b46a1f8d31a4f881ca7ed9cf094ab5
---

# @effected/github-commands

`@effected/github-commands` is the GitHub Actions **workflow-command grammar**
as pure functions. Strings in, strings out: no service, no layer, no `R`, no
`node:` import, no `effect` import at all, `"sideEffects": false`. It does two
things that are the same protocol seen from its two ends.

## The two modules

| Module | Concept |
| --- | --- |
| `WorkflowCommand` | Render a command, `::name key=value::message`, with the runner's escaping: `render`, and `debug`, `notice`, `warning`, `error`, `group`, `endGroup` and `addMask`, plus the `AnnotationProperties` that map readable field names onto GitHub's abbreviated wire names. Moved here unchanged from `@effected/github-actions`, which re-exports it at its entrypoint. |
| `CommandNeutralizer` | The opposite direction: make arbitrary text safe to write to a log. `CommandNeutralizer.lines(text)` splits at the runner's line breaks and returns each line neutralized, and `CommandNeutralizer.text(text)` joins them back. |

## The two-parser rule

The runner reads a command by two parsers (`actions/runner`,
`src/Runner.Common/ActionCommand.cs`, `TryParseV2` then `TryParse`), and a line
is a command if either accepts it:

- **V2:** `TrimStart()` with .NET whitespace (which includes U+0085), then
  `StartsWith("::")`. The neutralizer puts a braille pattern blank (U+2800,
  which .NET does not count as whitespace) in front of such a line.
- **Legacy:** `IndexOf("##[")`, so `##[` is a command wherever it occurs in the
  line. The neutralizer puts a braille pattern blank before the `[` at every
  occurrence.

Both comparisons are culture-sensitive, and the runner runs on ICU (it installs
libicu; nothing sets invariant globalization), which skips controls, format
characters, most combining marks and other default-ignorables as if absent. So
`"\u200b::x"` and `":\u200b:x"` are commands, and a zero-width marker defends
nothing. The neutralizer matches with those characters skipped, and its marker is
one ICU weighs. It is also not a default-ignorable code point, which Ink 8 drops
from a frame. The skipped set was measured on .NET 8, every code point, and the
test oracle holds it as `ICU_IGNORED`.

A bare `##` with no `[` straight after it is not a command and is left alone, so
a markdown heading survives. Input is split at CR, LF and CRLF, as the runner
splits a stream. The result is **idempotent**: a neutralized line no longer
matches either rule, so applying it twice, as `Render.githubLog` and the facade
in `@effected/cli` both do, adds nothing.

There is deliberately **no exported detector** (`isCommand`). A detector shipped
beside the neutralizer would be the implementation's own opinion of what a
command is, and a test that used it would pin the code's output as its own
oracle. The oracle lives in the test tree only, written independently from the
runner's source.

## Tier and dependencies

**Pure tier**, per [the tier taxonomy](../glossary/library-tier.md), the lowest
layer. Zero regular dependencies and no peer: nothing in it needs `effect`.
It takes no `@effected/*` edge, ever, so any package at any tier can depend on
it.

Consumers: `@effected/github-actions` (a regular dependency: `ActionLogger`
neutralizes the log text it writes, and the whole actions runtime emits commands
through `WorkflowCommand`) and `@effected/cli` (a regular dependency: the renderers,
`CliMessage`, the failure report and the loggers neutralize under GitHub
Actions). See [why the grammar left `github-actions`](../decisions/github-commands-extracted-from-actions.md).

## What the consumers do with it

A kit path that writes text a consumer supplied sanitises it and, where
`CurrentRuntimeEnv` says the runner is GitHub Actions, neutralizes it. The
failure to do so is a command-injection vector: an error message carrying a
newline and `::add-mask::` or `##[stop-commands]` is read by the runner as a
command.
