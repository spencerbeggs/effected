---
type: Decision
title: The workflow-command grammar left github-actions for its own pure package
description: "WorkflowCommand and the neutralizer live in the pure @effected/github-commands so a boundary-tier package can neutralize without the integrated github-actions tier and @effect/platform-node."
status: draft
tags: [architecture, deps, security]
generated:
  by: okfit/claude-code
  at: 2026-10-01T01:26:10Z
  body_sha256: e7663f41fc79cbbc2b451309d1ab4f2969d0f4da13b9f05f3e376e44dffd982a
---

# The workflow-command grammar left github-actions for its own pure package

## Context

`WorkflowCommand` rendered the GitHub Actions command protocol inside
`@effected/github-actions`, an integrated-tier package with a required peer on
`@effect/platform-node`. Neutralizing text so the runner cannot read it as a
command is the same grammar from the other end, and `@effected/cli` (boundary
tier) needs it: its renderers, `CliMessage`, the failure report and the loggers
all write consumer-supplied text into a log that the runner parses. `cli` could
not take `github-actions` for that: layering forbids a boundary package taking
an integrated one, and it would drag the platform package into every CLI.

The first answer was a copy: `cli` carried its own escaping and its own
neutralizer, with a comment that the duplication was deliberate. The copy made
two implementations of one protocol, and the neutralizer's first version modelled
only one of the runner's two parsers.

## Decision

The grammar moves to a pure, dependency-free package,
[`@effected/github-commands`](../modules/github-commands.md), holding
`WorkflowCommand` (moved unchanged) and `CommandNeutralizer` (the two-parser
rule). `@effected/github-actions` takes a required `workspace:^` peer on it and
re-exports `WorkflowCommand` and `AnnotationProperties` from its entrypoint, so
existing consumers keep compiling; `@effected/cli` takes the same peer and drops
its copies.

The reasons:

- One implementation of one protocol, so a correction (the legacy `##[` parser
  anywhere in a line) reaches `ActionLogger`, both `cli` loggers and the
  renderers at once.
- The kit's packages interlock rather than copy: where a pure rule is shared, a
  pure package at the lowest layer is the place, and any tier may depend on it.
- It costs consumers nothing: no `effect`, no platform, no peer to satisfy
  beyond the one edge.

## Consequences

- Every package that requires `cli` or `github-actions` declares
  `@effected/github-commands`, enforced by the peer-closure test.
- There is no exported detector, so the grammar package never offers a second
  opinion of what a command is; each consumer's tests carry an independent oracle.

This supersedes nothing: it extracts, and the earlier `cli` copy was never a
recorded decision beyond a code comment.
