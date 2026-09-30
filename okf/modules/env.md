---
type: Module
title: "@effected/env"
description: The boundary package that detects who is running a program and in what terminal — agent, CI, colour level, hyperlink support and width — through Config, with no node imports and no import-time reads.
status: draft
kind: package
resource: ../../packages/env
layer: boundary
tags: [architecture, bundle, dx]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, section 4
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T19:32:46Z
  body_sha256: a0699de2bb90e9c37cb8063a213005607e115f065801e9eca055b1d30bb21581
---

# @effected/env

`@effected/env` answers two questions for any front end of a tool: *who is
running this* and *what can the terminal do*.[^interactive-cli-kit-design]
It is a [boundary-tier](../glossary/library-tier.md) package with `effect` as
its only peer, no `node:` import, and nothing read at import time. Every
environment variable goes through `Config`, so a test controls it. Services
are static classes with private constructors, each shipping `.layer` and
`.layerTest(partial)`; `layerTest` is the only way a test changes the
environment.

It is its own package, and a required peer of `@effected/cli`, so that MCP
servers, engines and a Vitest plugin can detect without a CLI dependency; see
[its own package](../decisions/env-is-its-own-package.md).

## Public surface

| Export | Contract |
| --- | --- |
| `RuntimeEnv` (the snapshot Schema class) and its service | `{ agent: Option<string>, ci: Option<string>, terminal: Option<{ name, version }> }`. Built from `Config` only, so it is safe inside a stdio MCP server. A `Schema.Class`, so a consumer can persist it. The service tag's name is decided with the implementation. |
| `TerminalEnv` | `stdinIsTerminal`; per-stream `stdout` and `stderr`, each `{ isTerminal, color, hyperlinks, columns }`; `width(fallback)`, which reads stdout columns, then `COLUMNS`, then the fallback; and a standalone `colorLevel(stream)`. A snapshot, not live. |
| `Audience` | `human`, `agent` or `ci`. Precedence: a valid override environment variable, then agent, then CI, then human, so an agent inside a CI job gets agent output. |
| `EnvOverride` | Reads a variable that picks a mode *within* an audience. An invalid value logs one warning and yields `None`; it never fails the run. The kit never learns a consumer's literals. |

Colour follows Node's `getColorDepth` precedence
([decision](../decisions/force-color-honoured-node-precedence.md)). Hyperlink
detection is a port of std-osc8's pure core
([decision](../decisions/osc8-ported-not-wrapped.md)); hyperlinks being off
for the agent audience is applied in `cli`, where the audience is known, not
here.

## Bound by

- [`dependency-policy`](../conventions/dependency-policy.md)
- [`peer-dependency-discipline`](../conventions/peer-dependency-discipline.md)
- [`testing-standards`](../conventions/testing-standards.md)

## See also

- [`@effected/cli`](cli.md)
- [`@effected/engine`](engine.md)

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`
