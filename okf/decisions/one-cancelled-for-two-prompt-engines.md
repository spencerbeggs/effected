---
type: Decision
title: Two prompt engines raise one Cancelled error
description: Core Prompt and the kit's ./ui screens both surface a single Cancelled tagged error with reason escape or interrupt, carrying exit code 130, so a consumer maps cancellation once.
status: draft
tags: [architecture, dx]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 5.12 and 10
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:28:29Z
  body_sha256: ddd9c7bc60527de14367252b1f23e990cd7e52f4f34f178a6759db7f7e56ebfb
---

# Two prompt engines raise one Cancelled error

## Context

The kit supports two prompt engines. Core `Prompt` has no React and is what a
fallback prompt (`CliPrompt.fallback`) runs, but it cancels only on Ctrl-C or
Ctrl-D and emits ANSI unconditionally. The kit's `./ui` screens are built on
Ink and can cancel on Escape as well. The human ruled that both engines are
supported.[^interactive-cli-kit-design] Left alone, each engine would
surface cancellation its own way, and a consumer would map two failures to
the exit code a cancelled command should have.

## Decision

Both engines surface one error: `Cancelled`, a tagged error carrying
`reason: "escape" | "interrupt"`. Core's `QuitError` maps to
`Cancelled({ reason: "interrupt" })`, and a `./ui` screen raises `Cancelled`
with whichever reason the key was.

`Cancelled` carries exit code 130 on the class, through the same
runtime-marker mechanism the kit already uses for exit codes (see
[the exit code is set through core's own error markers](cli-exit-code-via-runtime-markers.md)),
so `CliRuntime` honours it without a per-consumer mapping. `CliRuntime.main`
renders it as one line, `cancelled; nothing written`, with no stack and no
`error:` prefix. A sibling `NotInteractive` error covers a prompt reached in a
non-interactive run and exits 64.

## Alternatives rejected

- **Kit screens only.** Rejected. It would leave core `Prompt` and every
  `CliPrompt.fallback` raising core's own `QuitError`, so a program using both
  a fallback prompt and a screen would still handle two cancellations.
- **Core `Prompt` only.** Rejected. It drops Escape cancellation and keeps
  unconditional ANSI, which is the reason the kit screens exist.

## Consequences

Every cancellation path in the kit is one class, so one test pins exit 130
for all of them. The `./ui` engine is planned (P4); until it lands only the
core-`Prompt` path raises `Cancelled`.

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`
