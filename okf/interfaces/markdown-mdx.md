---
type: Interface
title: "@effected/markdown MDX vocabulary"
description: A construction-and-serialization-only extension of the node model for MDX, shaped to three vendored oracle packages, with no MDX parse support.
status: stable
kind: api
resource: ../../packages/markdown/src/MarkdownNode.ts
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: f606ab142ffe8e597522ba87e6e02b5b9b461ffa907ea7fc738c7232257a4052
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:40.582Z
---

# `@effected/markdown` MDX vocabulary

The MDX vocabulary is a construction-and-serialization-only extension of the
[markdown module](../modules/markdown.md)'s node model: the MDX node classes
in `packages/markdown/src/MarkdownNode.ts`, the three unions they widen, and
the serialization rules `packages/markdown/src/internal/stringify.ts` applies
to them.

**The scope cut is deliberate and permanent: MDX parse is not supported.**
The engine reads no MDX syntax — a bare `<` or `{` in source is CommonMark
text or HTML, exactly as it is in a build without this vocabulary. A
consumer builds a tree carrying these nodes by hand, or via a schema encode,
and `Markdown.stringify` emits valid MDX. That keeps the parser's near-total
CommonMark contract untouched — no new syntax to disambiguate, no new parse
errors, no new hardening surface — while a markdown-emitting consumer
(documentation generators, codegen) can still produce `.mdx` output through
the same canonical stringifier the plain-markdown path guarantees
byte-stable. Full MDX parsing — a JS-expression parser, a JSX grammar — is a
distinct and much larger undertaking and is off this scope entirely, not
deferred inside it.

## The vocabulary and its oracles

The node classes are shaped exactly to three vendored oracle packages checked
out for reference (`mdast-util-mdx-jsx`, `mdast-util-mdx-expression` and
`mdast-util-mdxjs-esm`; see `.repos/config.json` for the pinned refs) as the
serialization authorities. Between them they cover the JSX element pair
(flow and text position), the attribute carriers, the expression pair, and
the ESM import/export block.

The ecosystem's `data.estree` compiler annotation is deliberately not
modeled: this package has no estree vocabulary, serialization never consults
it, and the `Mdast` admission boundary drops it silently the way it drops
every foreign `data` field — consistent with the package's general posture
of stripping fidelity and foreign extras at that boundary.

## Union widening

Three of the node model's unions admit these nodes, each following the
append-a-construction-only-member pattern the oracle packages' own
content-map registrations specify:

- `PhrasingContent` (text position) gains `MdxJsxTextElement | MdxTextExpression`.
- `FlowContent` (block position) gains `MdxJsxFlowElement | MdxFlowExpression`.
- `Root.children` gains `MdxjsEsm`, alongside `Frontmatter` — `MdxjsEsm` is
  only ever a `Root` child, per the `mdast-util-mdxjs-esm` oracle's own
  content-map; ESM cannot nest inside a JSX element or any other container.
  Like the frontmatter head-node constraint, this is structural (only
  `Root`'s children union admits it) rather than validated.

The parser never produces any MDX member of these unions — the same
"parser never emits this" posture as `Definition`/`FootnoteDefinition`
staying unresolved, applied to a vocabulary the parser cannot see at all.

`MdxJsxAttributeContent` (`MdxJsxAttribute | MdxJsxExpressionAttribute`) is a
fourth, narrower union: attribute carriers are node-shaped (they carry
`type` and `position`) but are not tree content — they live in a JSX
element's `attributes` array, never in a `children` array, so they are
excluded from the `MarkdownNode` selector union and invisible to the visitor
and to `MarkdownDocument.find`.

## Refusals at construction

Two shapes have no MDX spelling and are refused typed at construction and
decode, on the schema's own `Schema.check`/`Schema.makeFilter` terms rather
than left to crash at serialize time: an `MdxJsxAttribute` with an empty
`name` (moving the oracle's serialize-time crash to the admission boundary),
and an `MdxJsxFlowElement`/`MdxJsxTextElement` fragment (`name: null`)
carrying attributes (a fragment cannot carry them).

## Serialization fidelity to the oracles

`packages/markdown/src/internal/stringify.ts` reproduces the oracles'
defaults node-for-node: attribute values quote with `"` (the quote itself
escaped as `&#x22;`, matching the `stringify-entities` package's spelling,
never a backslash escape); an empty element self-closes spaced (`<a />`); a
fragment renders `<></>`; flow children take block layout indented two
spaces per JSX-ancestor depth, reset to zero on entering a blockquote, list
item or footnote definition, matching the oracle's own depth-inference
break, since those containers' own continuation prefixes take over
indentation; attributes move onto their own lines only when at least one
carries a line ending (this stringifier has no `printWidth` measure);
expressions emit `{expr}` with two-space continuation indent for embedded
newlines; and ESM `value` emits verbatim with no reformatting. Block content
nested inside a flow element still renders through this package's own
canonical table (bullet `-`, ATX headings, and so on) — the MDX structure is
oracle-shaped, the markdown inside it stays canonical.

## The `{`/`<` escaping invariant — presence-keyed, never a stringify option

A tree containing any MDX node additionally escapes `{` in text; a tree with
none serializes byte-identically to the published canonical table. `<` is
unconditionally in the always-escape set; MDX makes `{` significant too,
since it opens an expression anywhere in text, so the escape widens — but
only when the tree actually carries an MDX node. A presence pre-scan is
threaded through the stringifier's internal state, gating the one added
escape branch.

This is load-bearing and must never become a stringify option: the whole
point is that a plain-markdown consumer's byte-stability guarantee — the
corpus-wide re-parse equivalence property, the documented canonical-form
table in the [markdown module](../modules/markdown.md) — is untouched by MDX
sharing the same module, because the escape only activates on trees that
opted in by construction. An option would force every caller to know and set
it; presence-keying makes the two audiences (plain markdown, MDX) mutually
invisible to each other's concerns.

## Testing

The construction/serialization suite (`packages/markdown/__test__/mdx.test.ts`)
covers attribute value shapes (string, expression, boolean, `null`),
fragment refusals, nested flow-element indentation depth, the two-space
expression continuation, ESM verbatim emission, and the presence-keyed `{`
escape in both directions — MDX-carrying trees escape it, MDX-free trees do
not. There is no MDX parse suite, matching the scope cut; the CommonMark and
GFM corpora are the proof that the vocabulary does not perturb the parser
they exercise.
