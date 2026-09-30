---
type: Decision
title: "FORCE_COLOR is honoured, with Node's getColorDepth precedence"
description: "@effected/env reads FORCE_COLOR ahead of NO_COLOR, NODE_DISABLE_COLORS, TERM=dumb and the TTY gate, in the order Node's tty getColorDepth uses, replacing the kit's earlier decision to ignore it."
status: draft
supersedes: cli-color-ignores-force-color.md
tags: [architecture, dx]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 4.2 and 10
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T19:32:46Z
  body_sha256: 302356a202500e822d6227b2c6d740d640ac11c57a6bd75312f9dc77952c0f5b
---

# FORCE_COLOR is honoured, with Node's getColorDepth precedence

## Context

[D8](cli-color-ignores-force-color.md) kept `FORCE_COLOR` unread so that
`CliColor` would agree with core's own formatter. The interactive CLI kit
moves the colour decision into [`@effected/env`](../modules/env.md), where
it is shared by the CLI, MCP servers and test tooling, and where a consumer
running under a CI log or an agent transcript routinely sets `FORCE_COLOR`
to get colour through a non-TTY pipe. Ignoring it there is a defect, not a
posture.[^interactive-cli-kit-design]

## Decision

`TerminalEnv` honours `FORCE_COLOR`, using the order of Node's
`tty.getColorDepth`, highest first:

1. `FORCE_COLOR`: `''`, `'1'` and `'true'` give 16 colours, `'2'` gives 256,
   `'3'` gives truecolor, and any other value gives none.
2. A non-empty `NO_COLOR` or `NODE_DISABLE_COLORS`, and `TERM=dumb`.
3. The TTY gate: a stream that is not a terminal has no colour.
4. Node's environment table (`TERM`, `COLORTERM`, `TERM_PROGRAM`, CI
   vendors).

`FORCE_COLOR` beating `NO_COLOR` matches Node, which is the point: a
consumer reading the two documents together sees one behaviour.

## Alternatives rejected

- **Keep D8.** Rejected. Leaving `FORCE_COLOR` unread means a forced colour
  request over a pipe is silently dropped, and the package would keep
  disagreeing with Node itself, the reference every other tool is measured
  against.
- **Diverge from Node's order by letting `NO_COLOR` beat `FORCE_COLOR`.**
  Rejected. It reads as the safer default but produces a third precedence
  that matches neither Node nor the conventional `FORCE_COLOR` documentation,
  so two tools in one pipeline disagree about the same environment.

## Consequences

### Known disagreements with core

Three places in core do not follow this precedence. Each is to be raised as
an upstream issue in Effect-TS/effect and is named here so a reader does not
mistake the gap for a bug in `env`:

- Core's `Logger.consolePretty` in auto mode checks the TTY only.
- Core's `Prompt` and the wizard colour unconditionally.
- `CliOutput.defaultFormatter` reads `process` directly.

### Two documented divergences from Node

- `FORCE_COLOR=""` reads as unset here, because `ConfigProvider` drops empty
  strings before `env` sees them; Node treats it as 16 colours.
- There is no win32 branch, because `env` reads no `process.platform`.

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`
