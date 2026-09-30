---
type: Decision
title: "@effected/env is its own boundary package, a required peer of cli"
description: Audience and terminal detection live in a dedicated @effected/env package that @effected/cli requires as a peer; only the --audience flag lives in cli, so MCP servers and engines detect without a CLI dependency.
status: draft
tags: [architecture, bundle, deps]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 4 and 10
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T19:52:41Z
  body_sha256: 127a715c3d8cbcae4e5bdbc4bb1d9b136327e5200bb068daafe94f5bb6dd7015
---

# @effected/env is its own boundary package, a required peer of cli

## Context

Deciding whether the caller is a human, an agent or a CI job is needed well
outside a command-line program: a stdio MCP server must pick quiet,
machine-shaped output, an engine must stamp what it ran under, and a Vitest
plugin must choose a reporter. None of those may take a dependency on
`@effected/cli`, which only applications depend on (see
[`cli.md`](../modules/cli.md)).[^interactive-cli-kit-design]

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

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`
