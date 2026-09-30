---
type: Decision
title: Two prompt engines raise one Cancelled error
description: Core Prompt and the kit's ./ui screens both surface a single Cancelled tagged error with reason escape or interrupt, carrying exit code 130, so a consumer maps cancellation once.
status: draft
tags: [architecture, dx]
sources:
  - id: core-prompt
    resource: ../../.repos/effect/packages/effect/src/cli/Prompt.ts
    title: Core Prompt, which fails with Terminal.QuitError
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:33:06Z
  body_sha256: 1b4e92a2fd1eb2260f3f2ed58be8df745e6deef9e30c8f6cb74be83c69482898
---

# Two prompt engines raise one Cancelled error

## Context

The kit supports two prompt engines. Core `Prompt` has no React and is what a
fallback prompt (`CliPrompt.fallback`) runs, but it fails only with
`Terminal.QuitError`, when the prompt is quit or terminal input ends, and
emits ANSI unconditionally.[^core-prompt] The kit's `./ui` screens are built on
Ink and can cancel on Escape as well. The human ruled that both engines are
supported. Left alone, each engine would
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

[^core-prompt]: `../../.repos/effect/packages/effect/src/cli/Prompt.ts`
