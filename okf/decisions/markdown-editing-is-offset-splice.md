---
type: Decision
title: Markdown editing is offset-splice, not a lossless CST
description: "@effected/markdown edits source via offset/length/content splices over the original text, matching the jsonc/yaml/toml edit vocabulary, rather than a lossless concrete syntax tree."
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 634055a16759f1e4
---

# Markdown editing is offset-splice, not a lossless CST

## Context

`@effected/markdown` needed an editing model that lets a consumer make a
surgical change to a markdown document without corrupting or reformatting
the rest of it — the same requirement its `jsonc`, `yaml` and `toml`
siblings solved with an offset-splice edit vocabulary.

## Decision

The edit model is an offset/length/content edit plus an apply-all,
structurally identical to the `jsonc`, `yaml` and `toml` edit vocabularies.
Surgical edits are computed as offset-splices over the original source; the
canonical stringifier serves only synthesized trees, never a partial edit.
Apply-all adopts `toml`'s overlap-rejection posture (overlapping edits are a
thrown programmer-error defect, not a typed input-hardening failure), and
range filtering adopts `toml`'s owning-node-intersection posture. This
matches the [format-package convention](../conventions/format-package-convention.md)'s
binding cross-package parity contract, and is the pre-work for a
possible future shared text-edit kernel across the format packages.

## Alternatives rejected

**A lossless concrete syntax tree (CST) that a consumer edits and
re-serializes.** Rejected because nobody in the JavaScript markdown ecosystem
ships a lossless markdown CST: `remark`'s serializer reformats by design, and
its own maintainers recommend positional splicing over CST mutation for
surgical changes. Building and maintaining a lossless CST for markdown
specifically — where whitespace, list markers, fence characters and
delimiter runs all carry meaning — would be a much larger and more fragile
undertaking than the offset-splice model, for a capability the rest of the
kit's format packages already solve a different way.

## Consequences

A `@effected/markdown` consumer who has used `@effected/jsonc`'s or
`@effected/yaml`'s edit layer recognizes the shape immediately: edits are
plain `{ offset, length, content }` records, applied in one pass, rejecting
overlaps rather than resolving them silently. `MarkdownFormat.modify`'s
node-and-fragment replacement API is layered on top of this splice model
rather than replacing it — see the [markdown module](../modules/markdown.md)'s
editing section — and any future shared text-edit kernel across the four
format packages inherits this model as its common shape rather than
reconciling four independent ones.
