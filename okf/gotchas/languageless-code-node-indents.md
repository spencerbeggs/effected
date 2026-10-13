---
type: Gotcha
title: A language-less Code node stringifies as an indented block, not a fenced one
description: A Code node with neither lang nor fenceChar set serializes through Markdown.stringify as an indented code block by default, which most readers do not expect from a node they think of as "a fenced code block with no language".
status: stable
resource: ../../packages/markdown/src/MarkdownFormat.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d5148fbe654dfaf3
---

# A language-less Code node stringifies as an indented block, not a fenced one

## What a reader sees

A `Code` node is constructed (by hand, or by an AST transform) with a
`value` but no `lang` and no `fenceChar` set, and passed through
`Markdown.stringify`. The output is an indented block — four leading
spaces on every line — rather than the triple-backtick fenced block a
reader constructing "a code block" typically pictures.

## What they would wrongly conclude

That the serializer dropped the code block's fence, or that constructing
a `Code` node without an explicit language accidentally produced malformed
output.

## What is actually true

CommonMark's two code-block spellings — fenced and indented — are both
legitimate, and a `Code` node with neither `lang` nor `fenceChar` set
serializes as an **indented** block by default, because indentation is
the more minimal spelling when nothing forces a fence. `lang` and
`fenceChar` are present for fenced blocks and absent for indented ones —
their absence on the node is exactly how the serializer decides which
form to emit. This is default behavior working as designed, not a bug,
and it is easy to construct the node this way expecting a fence
specifically because "a code block" is colloquially the fenced kind.

## The check

Set `fenceChar` (or `lang`) explicitly on any `Code` node that must
serialize as fenced, or pass `MarkdownFormattingOptions.codeBlockStyle:
"fenced"` to `Markdown.stringify` to force every code block — including
language-less ones — through the fenced spelling.[^markdown-format] Note
the one exception this override cannot reach: a language-less block
directly after a list item is absorbed as list content if indented, so
the serializer forces a fence there regardless of the requested style,
independent of the general default.

[^markdown-format]: `packages/markdown/src/MarkdownFormat.ts:426-436` —
    `isLanguagelessCode` and the surrounding comment on the fenced-versus-
    indented decision; `packages/markdown/src/MarkdownNode.ts:486-497`
    documents `lang`/`fenceChar`'s presence-as-signal on the `Code` node
    itself.
