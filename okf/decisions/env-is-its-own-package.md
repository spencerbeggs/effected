---
type: Decision
title: "@effected/env is its own boundary package, a required peer of cli"
description: Audience and terminal detection live in a dedicated @effected/env package that @effected/cli requires as a peer; only the --audience flag lives in cli, so MCP servers and engines detect without a CLI dependency.
status: draft
tags: [architecture, bundle, deps]
sources:
  - id: boundary-test
    resource: ../../packages/env/__test__/purity.test.ts
    title: "env purity: no process read, node: import, platform or kit import, or console write in src"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: 8a9f77cf139801b1714904d05b57f259fb2b9a0a14bf4d24f34332a742ca2bbe
---

# @effected/env is its own boundary package, a required peer of cli

## Context

Deciding whether the caller is a human, an agent or a CI job is needed well
outside a command-line program: a stdio MCP server must pick quiet,
machine-shaped output, an engine must stamp what it ran under, and a Vitest
plugin must choose a reporter. None of those may take a dependency on
`@effected/cli`, which only applications depend on (see
[`cli.md`](../modules/cli.md)).[^boundary-test]

## Decision

`@effected/env` is its own boundary package and a required peer of
`@effected/cli`. Audience and terminal *detection* (`RuntimeEnv`,
`TerminalEnv`, `Audience`, `EnvOverride`) live in `env`. Only the
`--audience` flag, which lets a user override detection on one invocation,
lives in `cli`. See [`env.md`](../modules/env.md).

## Alternatives rejected

- **Fold detection into `@effected/cli`.** Rejected. It would force every
  MCP server, engine and test plugin that needs detection to install the CLI
  package and its presentation layer, and would break the engine rule that a
  consumer engine may not import `cli`.

## Consequences

`cli` declares `@effected/env` as a peer under
[`peer-dependency-discipline`](../conventions/peer-dependency-discipline.md),
so a consumer resolves one copy of the `CurrentRuntimeEnv`, `TerminalEnv` and
`Audience` service tags. A second resolved copy would be two distinct tags and a layer built
from one would not satisfy the other.

[^boundary-test]: `packages/env/__test__/purity.test.ts`, which scans env's source for exactly those; env's manifest lists `effect` as its only peer, and `packages/cli/package.json` lists `@effected/env` as a required one
