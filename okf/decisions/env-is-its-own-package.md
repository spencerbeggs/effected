---
type: Decision
title: "@effected/env is its own boundary package, a required peer of cli"
description: Audience and terminal detection live in a dedicated @effected/env package that @effected/cli-kit requires as a peer; only the --audience flag lives in cli, so MCP servers and engines detect without a CLI dependency.
status: stable
tags: [architecture, bundle, deps]
sources:
  - id: boundary-test
    resource: ../../packages/env/__test__/purity.test.ts
    title: "env purity: no process read, node: import, platform or kit import, or console write in src"
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T15:53:05Z
integrity:
  generated:
    body: b7aad6fce0e2eb70
  verified:
    by: human:spencer
    at: 2026-11-02T17:04:46Z
    content: e7f1ccf01b6d863a
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-11-02T17:04:46Z
---

# @effected/env is its own boundary package, a required peer of cli

## Context

Deciding whether the caller is a human, an agent or a CI job is needed well
outside a command-line program: a stdio MCP server must pick quiet,
machine-shaped output, an engine must stamp what it ran under, and a Vitest
plugin must choose a reporter. None of those may take a dependency on
`@effected/cli-kit`, which only applications depend on (see
[`cli-kit.md`](../modules/cli-kit.md)).[^boundary-test]

## Decision

`@effected/env` is its own boundary package and a required peer of
`@effected/cli-kit`. Audience and terminal *detection* (`RuntimeEnv`,
`TerminalEnv`, `Audience`, `EnvOverride`) live in `env`. Only the
`--audience` flag, which lets a user override detection on one invocation,
lives in `cli-kit`. See [`env.md`](../modules/env.md).

## Alternatives rejected

- **Fold detection into `@effected/cli-kit`.** Rejected. It would force every
  MCP server, engine and test plugin that needs detection to install the CLI
  package and its presentation layer, and would break the engine rule that a
  consumer engine may not import `cli-kit`.

## Consequences

`cli-kit` declares `@effected/env` as a peer under
[`peer-dependency-discipline`](../conventions/peer-dependency-discipline.md),
so a consumer resolves one copy of the `CurrentRuntimeEnv`, `TerminalEnv` and
`Audience` service tags. A second resolved copy would be two distinct tags and a layer built
from one would not satisfy the other.

[^boundary-test]: `packages/env/__test__/purity.test.ts`, which scans env's source for exactly those; env's manifest lists `effect` as its only peer, and `packages/cli-kit/package.json` lists `@effected/env` as a required one
