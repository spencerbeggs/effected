---
type: Limitation
title: MarkdownFormat.modify refuses frontmatter, list items, table rows and the root
description: The node-replacement edit API fails typed rather than replacing a frontmatter node, a list item, a table row, or the document root.
status: stable
bounds: ../modules/markdown.md
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 016d270274695b2f
---

# `MarkdownFormat.modify` refuses frontmatter, list items, table rows and the root

## Condition and symptom

Calling `MarkdownFormat.modify` (`packages/markdown/src/MarkdownFormat.ts:690`)
with a target node whose type is `frontmatter`, or with a target that is a
list item, a table row, or the document root, fails typed with an
`UnsupportedTarget` error rather than performing the replacement. The same
error also fires for a multi-line replacement whose target sits inside a
container — a blockquote, list, table or heading — whose continuation lines
the offset splice cannot prefix.

## Why this is acceptable

`modify` renders every replacement through the canonical stringifier so that
the modified document re-parses cleanly by construction. The refused targets
either have no single-node replacement slot the splice can express safely
(the root, a list item's marker-prefixed content, a table row's cell
alignment), or, for frontmatter specifically, already have a dedicated
write path — the [frontmatter write seam](../interfaces/markdown-frontmatter.md#read-and-write),
which replaces the whole capture (both fence lines included) rather than
treating the frontmatter node as an ordinary tree node. Refusing typed at
day one, with a code naming which refusal applied, is the conservative
choice consistent with the rest of the package's editing posture: an
operation the splice cannot represent safely fails loudly rather than
producing a document that looks modified but re-parses wrong.

## What the fix would take

Supporting frontmatter replacement through `modify` directly would mean
teaching the splice about the fence-aware whole-block replacement the write
seam already performs, so the two paths do not diverge — this is named
explicitly as planned follow-up work ("frontmatter completion in markdown")
in the kit's roadmap. Supporting list items and table rows would require the
splice to understand each container's continuation-line prefix well enough
to rewrite it consistently, which is a larger change to the edit layer
itself.
