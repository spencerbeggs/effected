---
type: Decision
title: "D6: CLI and MCP knowledge stays in separate skills, linked from design-patterns"
description: effect-v4-cli and the new effect-v4-mcp stay independent skills rather than folding into design-patterns, which points at both instead of teaching either surface itself.
status: stable
tags: [architecture, docs]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 298f14aec759fdbcfd351c66c1f76c15cbfde418ee775d7a30da34f7ed598448
verified:
  - by: human:spencer
    at: 2026-09-23T19:50:29Z
---

# D6: CLI and MCP knowledge stays in separate skills, linked from `design-patterns`

## Context

`design-patterns` teaches the carrier pattern itself: core, engine, front
ends, carrier package, and the cross-cutting primitives (`CurrentDistribution`,
`WorkspaceLayering`, `PackedInstall`, `SourceBoundary`, `McpProbe`) that
make the pattern coherent. `effect-v4-cli` teaches one front end in depth:
`CliRuntime.main`, `CliExit`, `CliColor`, `CliTest`, the exit-code
contract, the stdout/stderr split, and CLI-specific gotchas
(`Command.provide`'s layer-build timing, `Flag.File`'s `mustExist` exit
code, positional binding order). The planned `effect-v4-mcp` teaches the
other front end in the same depth: `McpStdio`, `ToolFailure`,
`ToolInputSchema`, `McpToolkit` if built, the `Tool.make` idioms, and how
successes and failures appear on the wire. Each front-end skill is already
sized near or at the lean-index budget on its own (`effect-v4-cli` moves
to `references/` as part of this phase specifically because it has grown
too large to stay flat).

## Decision

`effect-v4-cli` and `effect-v4-mcp` remain two separate, independently
loadable skills. `design-patterns` links both rather than absorbing either
one's content, and its own carrier-pattern references point at kit
exports (`CurrentDistribution`, `WorkspaceLayering`, `PackedInstall`,
`SourceBoundary`, `McpProbe`) rather than restating what those exports do.

## Alternatives rejected

**Folding CLI and MCP knowledge into `design-patterns`.** Rejected — an
agent building a CLI front end has no need to load MCP wire-format detail
in the same context window, and vice versa; the two front ends do not
compose with each other by design (`cli` and `mcp` never depend on one
another), so their skills should not either. Folding them together would
also blow well past `okf/conventions/skill-shape.md`'s lean-index budget
for a single skill, forcing exactly the `references/` split
`effect-v4-cli` is already undergoing on its own.

## Consequences

An agent working on a carrier-pattern tool's overall shape loads
`design-patterns` alone and gets pointers, not duplicated prose, into
whichever front-end skill its current task needs. Each front-end skill
stays independently maintainable: an `effect-v4-cli` refresh (this
design's phase 1 and 4) does not force a simultaneous `effect-v4-mcp`
edit, and vice versa for phase 2's MCP work. The 32-to-34-package kit
composition table and the `effected-packages` skill index both gain rows
for `engine` and `mcp` as part of this same phase-4 work, so an agent
choosing a skill by package name finds the right one without reading
`design-patterns` first.
