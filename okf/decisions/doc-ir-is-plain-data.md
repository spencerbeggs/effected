---
type: Decision
title: The document IR is plain frozen data, not Schema classes
description: "The cli document IR is an immutable union of plain objects discriminated by _tag, built by constructors and rendered by pure (doc, context) => string functions, rather than Schema classes or React elements."
status: stable
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T22:58:53Z
  body_sha256: 0f1a229fdc56d0bcfa267660fa6879fce626dc25e3e62413d7ec49b127ce70a2
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# The document IR is plain frozen data, not Schema classes

## Context

`@effected/cli` is gaining a document IR (`Doc`) that failure rendering, the
two schema-issue renderers and later screens build once and render four ways:
plain text, ANSI, markdown and GitHub log lines. The house default for a model
is a `Schema.Class`, so the choice needs a reason.

## Decision

A node is a plain frozen object with a `_tag`, built by a constructor
(`Doc.text`, `Doc.table`, ...). A renderer is a pure function of the document
and a render context. Nothing decodes a document: no input crosses a trust
boundary into the IR, so a schema would validate data the package itself
produced.

A status node holds a resolved `StatusDef` (`Status.resolve`), never a
`Status` value. A `Status` is a class instance with private state, which a
schema cannot encode and structural equality cannot compare; the resolved
definition is plain data.

## Alternatives rejected

- **`Schema.Class` nodes.** Rejected. It buys decoding and encoding that
  nothing uses, and it cannot hold a `Status`.
- **React elements as the IR.** Rejected. The root must stay React-free so a
  non-interactive CLI never loads `ink` or `react`; the IR has to be
  renderable to a string without either.

## Consequences

Equality and snapshots are structural, a document is safe to share between
renderers, and the IR has no runtime dependency. A consumer who wants to
persist a document has to define its own encoding; the package offers none.
