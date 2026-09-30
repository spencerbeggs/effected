---
type: Decision
title: The cli renderers have no JSON output
description: "Render ships plain, ANSI, markdown and GitHub-log renderers and no JSON renderer, because both consumers encode their own schemas and JSON is data, not a rendering of a document."
status: draft
tags: [architecture, dx]
sources:
  - id: vitest-agent
    resource: ../consumers/vitest-agent.md
    title: The consumer that said JSON is not an IR rendering
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T22:58:53Z
  body_sha256: 23e0fbe404491f7ffaa594c1b66a67051b76185d4b08d5b257725bd0e98dcbee
---

# The cli renderers have no JSON output

## Context

A machine reader of a CLI wants structured output, so a JSON renderer for the
[document IR](doc-ir-is-plain-data.md) looks like the obvious fourth
rendering.

## Decision

`Render` has no JSON renderer. The two consumers that emit JSON,[^vitest-agent]
and `okfit`, each encode their own schemas, and they told us a JSON dump of a
document tree is not what they mean by structured output: the tree describes
layout, and their output describes results. A renderer that serialised the IR
would be an API nobody calls and a second contract to keep stable.

## Alternatives rejected

- **A `Render.json` over the IR.** Rejected. It would publish the node shapes
  as a wire format, freezing them, for no consumer.

## Consequences

A program emitting JSON encodes its own result schema and writes it through
`Console`, as today. The agent audience gets the plain renderer, with no
escapes.

[^vitest-agent]: `../consumers/vitest-agent.md`
