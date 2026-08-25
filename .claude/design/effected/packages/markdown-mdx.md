---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - markdown.md
  - markdown-frontmatter.md
  - ../effect-standards.md
---

# @effected/markdown — the MDX vocabulary

## Overview

The MDX vocabulary is a construction-and-serialization-only extension of [`@effected/markdown`](markdown.md)'s node model: eight node classes in `src/MarkdownNode.ts`, the three unions they widen, and the serialization rules `src/internal/stringify.ts` applies to them.

**The scope cut is deliberate and permanent: MDX parse is not supported.** The engine reads no MDX syntax — a bare `<` or `{` in source is CommonMark text or HTML, exactly as it is in a package build without this vocabulary. A consumer builds a tree carrying these nodes by hand (or via a schema encode) and `Markdown.stringify` emits valid MDX. That keeps the parser's near-total CommonMark contract untouched — no new syntax to disambiguate, no new parse errors, no new hardening surface — while a markdown-emitting consumer (documentation generators, codegen) can still produce `.mdx` output through the same canonical stringifier the plain-markdown path guarantees byte-stable. Full MDX parsing is a distinct and much larger undertaking (a JS-expression parser, a JSX grammar) and is off this scope, not deferred inside it.

## The vocabulary and its oracles

The node classes are shaped exactly to three vendored oracles checked out under `.repos/` as the serialization authorities — `mdast-util-mdx-jsx@3.2.0`, `mdast-util-mdx-expression@2.0.1` and `mdast-util-mdxjs-esm@2.0.1`. Between them they cover the JSX element pair (flow and text position), the attribute carriers, the expression pair and the ESM import/export block. See `src/MarkdownNode.ts` for the classes and their fields, and the port note at the head of `src/internal/stringify.ts` for the pins.

**The ecosystem's `data.estree` compiler annotation is deliberately NOT modeled.** This package has no estree vocabulary, serialization never consults it, and the `Mdast` admission boundary drops it silently the way it drops every foreign `data` field — consistent with the package's general posture of stripping fidelity and foreign extras at that boundary.

## Union widening

Three of the node model's unions admit these nodes, each following the append-a-construction-only-member pattern the mdast-util-mdx `*ContentMap` registrations specify:

- `PhrasingContent` (text position) **+=** `MdxJsxTextElement | MdxTextExpression`.
- `FlowContent` (block position) **+=** `MdxJsxFlowElement | MdxFlowExpression`.
- `Root.children` **+=** `MdxjsEsm`, alongside `Frontmatter` — `MdxjsEsm` is only ever a `Root` child, per mdast-util-mdxjs-esm's `RootContentMap`; ESM cannot nest inside a JSX element or any other container. Like the frontmatter head-node constraint, this is structural (only `Root`'s children union admits it) rather than validated.

The parser never produces any MDX member of these unions — the same "parser never emits this" posture as `Definition`/`FootnoteDefinition` staying unresolved, applied to a vocabulary the parser cannot see at all.

`MdxJsxAttributeContent` (`MdxJsxAttribute | MdxJsxExpressionAttribute`) is a fourth, **narrower** union: attribute carriers are node-shaped (they carry `type` and `position`) but are **not tree content** — they live in a JSX element's `attributes` array, never in a `children` array, so they are excluded from the `MarkdownNode` selector union and invisible to the visitor and to `MarkdownDocument.find`.

## Refusals at construction

Two shapes have no MDX spelling and are refused typed at construction and decode, on the schema's own `Schema.check`/`Schema.makeFilter` terms rather than left to crash at serialize time: an `MdxJsxAttribute` with an empty `name` (moving the oracle's serialize-time crash to the admission boundary), and an `MdxJsxFlowElement`/`MdxJsxTextElement` fragment (`name: null`) carrying attributes (a fragment `<></>` cannot carry them).

## Serialization fidelity to the oracles

`src/internal/stringify.ts` reproduces the oracles' defaults node-for-node: attribute values quote with `"` (the quote itself escaped as `&#x22;`, matching `stringify-entities`'s spelling, never a backslash escape), an empty element self-closes spaced (`<a />`), a fragment renders `<></>`, flow children take block layout indented two spaces per JSX-ancestor depth (tracked on `StringifyState.jsxDepth`, reset to zero on entering a blockquote, list item or footnote definition — the oracle's own `inferDepth` break, since those containers' own continuation prefixes take over indentation), attributes move onto their own lines only when at least one carries a line ending (never on a `printWidth` measure — this stringifier has none), expressions emit `{expr}` with two-space continuation indent for embedded newlines, and ESM `value` emits verbatim with no reformatting. Child **block** content nested inside a flow element still renders through this package's own canonical table (bullet `-`, ATX headings, …) — the MDX structure is oracle-shaped, the markdown inside it stays canonical.

## The `{`/`<` escaping invariant — presence-keyed, never a stringify option

**A tree containing any MDX node additionally escapes `{` in text; a tree with none serializes byte-identically to the published canonical table.** `<` is unconditionally in the always-escape set; MDX makes `{` significant too (it opens an expression anywhere in text), so the escape widens — but *only* when the tree actually carries an MDX node. `treeContainsMdx` is an iterative (deliberately unguarded — a single presence check, not a hostile-input surface) pre-scan threaded through `StringifyState.mdx`, and `escapeText`'s `mdx` parameter gates the one added escape branch.

This is **load-bearing and must never become a stringify option**: the whole point is that a plain-markdown consumer's byte-stability guarantee — the corpus-wide re-parse equivalence property, the documented canonical-form table — is untouched by MDX sharing the same module, because the escape only activates on trees that opted in by construction. An option would force every caller to know and set it; presence-keying makes the two audiences (plain markdown, MDX) mutually invisible to each other's concerns.

## Testing

`__test__/mdx.test.ts` is the construction/serialization suite: attribute value shapes (string, expression, boolean, `null`), fragment refusals, nested flow-element indentation depth, the two-space expression continuation, ESM verbatim emission and the presence-keyed `{` escape (both directions — MDX-carrying trees escape it, MDX-free trees do not). There is no MDX parse suite, matching the scope cut; the CommonMark and GFM corpora are the proof that the vocabulary does not perturb the parser they exercise.
