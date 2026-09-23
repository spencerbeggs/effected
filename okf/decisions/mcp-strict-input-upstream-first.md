---
type: Decision
title: "D2: strict MCP input is upstream-first"
description: Ship pure ToolInputSchema walkers now, and add an McpToolkit decorator only if probe P1 proves the registerToolkit port round-trips; do not consolidate a full port into the kit.
status: stable
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 085f2b4fa5fcf373e74892c6c2356dbb081405b569ed39fb653a2e2e063cb6de
verified:
  - by: human:spencer
    at: 2026-09-23T19:50:29Z
---

# D2: strict MCP input is upstream-first

## Context

An MCP tool declared with an open input schema silently accepts unknown
keys — a client typo or a stale schema goes unnoticed instead of failing
loudly. Two consumers (vitest-agent, systems) each ported their own
`registerToolkit` to wrap `addTool` with a pre-check that rejects unknown
keys, and both ports duplicate the same walk over a served JSON Schema.
Native `Tool.Strict` exists upstream but has two open gaps this design's
own probes and upstream-issues sections name: it reports only the first
unknown key rather than all of them (`McpServer.ts:1832` decodes without
`errors: "all"`), and a tool whose parameters are a top-level union dies
at boot rather than validating (`ToolJson` requires `type: "object"`,
decoded with `orDie`). Consolidating a full `registerToolkit` port into
the kit would mean owning a moving target against every future
`effect/unstable/ai` release, and `okf/decisions/cli-handler-accessor-gap-filed-upstream.md`
already set the kit's precedent for handling this class of gap by filing
upstream rather than shimming around it.

## Decision

Ship `ToolInputSchema` — pure, dependency-free walkers over a served JSON
Schema (`unknownKeys`, `formatUnknownKeys`, `objectRooted`) — as ordinary
kit surface now, `Effect`-free and requiring nothing. Build the
`McpToolkit.layer` decorator (a registration-scoped `McpServer` wrapping
core's `registerToolkit`) only if probe P1 confirms it round-trips every
tool with handlers still matched by `tool.id` and survives
re-annotation with `Tool.Strict`. If P1 fails, `McpToolkit` becomes a
skill recipe instead of packaged surface. Either way, file the two
upstream gaps (`Tool.Strict`'s first-key-only report,
the top-level-union boot failure) on Effect-TS/effect in phase 2 rather
than working around them permanently in the kit.

## Alternatives rejected

**Consolidating the `registerToolkit` port into the kit unconditionally.**
Rejected — a full port re-implements internal core wiring the kit does
not control, and every rc advance would need re-diffing against upstream
internals rather than against public exports, the exact cost
`cli-handler-accessor-gap-filed-upstream.md` already ruled against for
the CLI side.

**Native `Tool.Strict` only, with no kit decorator at all.** Rejected
before verifying: `Tool.Strict`'s two known gaps (single-key reporting,
union-root boot failure) make it insufficient on its own for the
consumers this design targets, at least until the upstream issues land.
Shipping `ToolInputSchema` as pure walkers gives every consumer working
unknown-key detection immediately, independent of whether `Tool.Strict`
or `McpToolkit` ever close the gap.

## Consequences

Phase 1 ships nothing MCP-shaped at all — `@effected/mcp` is design-only
this phase (see [`modules/mcp.md`](../modules/mcp.md)). Phase 2 runs
probe P1 before committing to `McpToolkit`; a failed probe demotes it to
a skill recipe without blocking the rest of the package. The two upstream
issues are filed regardless of P1's outcome, since both are real gaps a
future core release could close independent of this kit's own decision.
