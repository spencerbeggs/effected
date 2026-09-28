---
type: Decision
title: "Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking"
description: "Core's strict tool decode reports every unknown key, missing field and invalid field in one InvalidParams, so McpToolkit.layer drops its unknown-key pre-check and instead appends an Accepted params line per offending level to core's report, unionHandler decodes with errors: \"all\" and appends the same lines, and ToolInputSchema stays public for Tool.dynamic payloads."
status: draft
supersedes: mcp-strict-input-upstream-first.md
tags: [architecture]
sources:
  - id: core-decode
    resource: ../../.repos/effect/packages/effect/src/ai/McpServer.ts
  - id: upstream-8495
    resource: https://github.com/Effect-TS/effect/issues/8495
  - id: upstream-8508
    resource: https://github.com/Effect-TS/effect/pull/8508
  - id: upstream-8496
    resource: https://github.com/Effect-TS/effect/issues/8496
  - id: toolkit
    resource: ../../packages/mcp/src/McpToolkit.ts
  - id: vitest-agent-friction
    resource: "vitest-agent dogfood findings, rc-118 loop round 1, friction 1 (the accepted-params list is a documented consumer contract)"
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-28T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 4a505291456fbd27f3e583511ca5711133ecc39c8c04e83ef9720f47575d2e2e
verified:
  - by: human:spencer
    at: 2026-09-28T17:11:35Z
  - by: human:spencer
    at: 2026-09-28T17:52:49Z
---

# Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking

## Context

[D2](mcp-strict-input-upstream-first.md) rested on two core gaps. The
first was that a `Tool.Strict` tool's rejection named only the first
unknown key. Both gaps were filed upstream as that decision required. The
first-key gap is closed[^upstream-8495][^upstream-8508]: core's
`registerToolkit` now decodes every tool's parameters with
`errors: "all"`, and a strict tool also with `onExcessProperty: "error"`[^core-decode].
A live `tools/call` probe against a strict tool, with two extra top-level
keys, an extra nested key and a missing required field, got one
`InvalidParams` from core naming all four.

`McpToolkit.layer`'s pre-check ran before core's decode and answered on
its own. So the same call got the kit's report, which names only the
unknown keys and drops the missing field. The agent then needed a second
round trip, which is the cost D2 set out to remove. The two reports never
appeared together; the kit's replaced core's. `unionHandler` did the same
over its own union decode.

The second gap, a top-level union `parameters` schema dying at
registration, is intended upstream. The maintainers answered by making the
registration error clearer, not by accepting unions[^upstream-8496].

## Decision

- `McpToolkit.layer` stops running an unknown-key pre-check in front of a
  strict `Tool.make` tool. Rejection and its report are core's.
- `McpToolkit.layer` appends to core's report, after the decode, never in
  place of it. For each object level of the payload that carries a key the
  served input schema does not accept, it adds one line naming what that
  level accepts: `Accepted params at the root: query, filter.` or
  `Accepted params at ["filter"]: kind, tag.`, the path written as core
  writes it, with `keys matching <pattern>` for keys accepted by
  `patternProperties`, and `This tool accepts no params.` for a
  zero-parameter tool. A failure with no unknown key is core's report
  unchanged. Core's report alone names the bad path but not what the level
  accepts, and a consumer documents that list as the contract that lets an
  agent fix the call without re-reading the tool description[^vitest-agent-friction].
  The lines are appended to the `InvalidParams` the registered handler
  fails with, which core raises only for a parameter failure[^toolkit].
- `McpToolkit.layer` keeps registering through core's `registerToolkit`
  and keeps its strict-by-default re-annotation
  ([strict default for Claude Code](mcp-strict-default-for-claude-code.md)),
  which this decision does not change[^toolkit].
- `McpToolkit.unionTool` and `unionHandler` stay, because core still
  refuses union parameters. The union payload is decoded with
  `errors: "all"` and `onExcessProperty: "error"`, which picks the member
  by its discriminant and names every excess, missing and invalid field
  in one `InvalidParams`, followed by the same `Accepted params` lines.
- `McpToolkitOptions.unknownKeyMessage` is deprecated and ignored, one
  release before removal. So is `UnionHandlerOptions.unknownKeyMessage`.
  The appended lines are fixed text; a customisation hook is added only if
  a consumer needs one.
- `ToolInputSchema.unknownKeys`, `formatUnknownKeys` and `objectRooted`
  stay public. They exist for a `Tool.dynamic` tool's raw payload, which
  core never validates strictly (a strict dynamic tool dies at
  registration), and for rewriting a raw union schema to an object root.

The repository owner approved this change on the audit's evidence[^owner].

## Alternatives rejected

**Keep the pre-check and append core's decode errors to it.** Rejected:
it re-implements a report core now produces in full, and it keeps a
second rendering of the same failure that every core release would have
to be re-diffed against.

**Keep the pre-check only for its "Accepted params" list.** Rejected: the
list is the only information core's report lacks, and it does not justify
hiding missing and invalid fields. The list is appended to core's report
after the decode instead (see Decision).

## Consequences

- A strict `Tool.make` tool's bad call carries core's report under both
  `McpToolkit.layer` and core's `McpServer.toolkit`, but only the layer
  appends the `Accepted params` lines, so a consumer moving between the
  two sees those lines appear or disappear. A union tool's report is
  identical on every path (the layer, `McpServer.toolkit`, or a direct
  `unionHandler` call), because the lines come from the shared union
  decode.
- Skills and module docs that describe the pre-check, or core as
  "reporting only the first key", are corrected to describe core's
  all-errors report and the lines the layer appends to it.
- The per-revision shape of an `InvalidParams` is unchanged: a JSON-RPC
  `-32602` error on `2025-06-18` and older, an `isError` tool result on
  `2025-11-25` and the stateless revision.

[^core-decode]: `packages/effect/src/ai/McpServer.ts`, `registerToolkit`'s `decodeOptions`.
[^upstream-8495]: Effect-TS/effect issue 8495, a strict tool's parameter rejection names only the first unknown key.
[^upstream-8508]: Effect-TS/effect PR 8508, report all MCP tool parameter validation errors.
[^upstream-8496]: Effect-TS/effect issue 8496, closed as intended; the registration error was clarified instead.
[^toolkit]: `packages/mcp/src/McpToolkit.ts`
[^vitest-agent-friction]: vitest-agent dogfood findings, rc-118 loop round 1, friction 1.
[^owner]: conversation with the repository owner, 2026-09-28.
