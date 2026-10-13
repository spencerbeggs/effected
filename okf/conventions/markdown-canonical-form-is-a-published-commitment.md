---
type: Convention
title: The markdown canonical form is a published commitment — a row that moves is a breaking change
description: "Markdown.stringify takes no options and its output is documented as stable; change a canonical choice only as a breaking change, updating the TSDoc table, the README table and the byte-level suite together."
status: stable
stale_after: "2027-03-21T00:00:00Z"
tags:
  - release
  - compat
sources:
  - id: stringify-tsdoc
    resource: ../../packages/markdown/src/Markdown.ts
  - id: readme-canonical
    resource: ../../packages/markdown/README.md
  - id: stringify-suite
    resource: ../../packages/markdown/__test__/stringify.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-27T21:38:36Z
integrity:
  generated:
    body: 1ca4e0d7e7243e42
---

# The markdown canonical form is a published commitment — a row that moves is a breaking change

`Markdown.stringify` in the [markdown module](../modules/markdown.md) takes
no options, and its output is documented as stable on the TSDoc of
`Markdown.stringifyResult`[^stringify-tsdoc] and in the package README's
"The canonical form is stable" section[^readme-canonical]: a consumer is
told they may assert on these bytes, and that a pipeline needing stable
rendered markdown should serialize through here rather than through a
third-party stringifier whose defaults are free to move. The "documented
canonical form" suite asserts every row of that published table
byte-for-byte[^stringify-suite].

## The rule

- **Treat any change to a canonical choice as a breaking change**, never a
  patch, and bump accordingly. A row that moves silently breaks a promise
  consumers were invited to depend on.
- **Update the three copies together**: the table on
  `Markdown.stringifyResult`'s TSDoc, the README table, and the
  "documented canonical form" suite. A row present in one and absent from
  another is a drifted promise.
- **Never add a `stringify` option.** The configurable surface is
  `MarkdownFormat` + `MarkdownFormattingOptions`; the canonical stringifier
  is deliberately option-free so the corpora stay byte-stable. In
  particular the MDX `{` escape stays presence-keyed rather than becoming an
  option — see [the presence-keyed escape
  decision](../decisions/markdown-mdx-escape-presence-keyed.md).

## The two escapes the table itself states

Both were found by a consumer rather than by the package, and both are
documented on the same surfaces rather than left to be rediscovered:

- **Representability outranks a row.** The canonical form never emits text
  that would re-parse as something else, so a row yields where the two
  conflict. The case that reaches consumers is a language-less `Code` node
  directly after a list: indenting there is absorbed as list content, so it
  emits fenced in that position and indented everywhere else — a byte
  assertion over synthesized code blocks therefore depends on the
  preceding sibling. See
  [languageless-code-node-indents](../gotchas/languageless-code-node-indents.md).
  A representability fix — canonical output that did not round-trip, such
  as a table that re-parsed as a paragraph — changes bytes only for output
  that was already broken, so it ships as a minor, not a breaking change.
- **`Mdast.fromMdast` strips fidelity fields**, being a spec-mdast admission
  boundary, so fidelity fields are settable only on the decoded tree; the
  drop is correct and silent, which is why both the boundary and the
  emitter document it. The single exception is `Text`'s `escapeStyle`, an
  emitter instruction the boundary admits.

## Adding an opt-out is additive; changing a default is not

A per-node opt-out that a tree must set explicitly leaves every tree that
does not set it byte-identical, so it is a minor change. `Text`'s
`escapeStyle: "literal"` is the model: it drops inline-phase escaping for
that node only, keeps the escapes that defend block structure, and is
pinned against the canonical bytes by
`packages/markdown/__test__/stringify-literal.test.ts`. Changing what the
default escapes is still a breaking change.

[^stringify-tsdoc]: `packages/markdown/src/Markdown.ts` — the "canonical form is a stability commitment" TSDoc on `stringifyResult` and `stringify`.
[^readme-canonical]: `packages/markdown/README.md` — "The canonical form is stable", including "Representability wins over the table".
[^stringify-suite]: `packages/markdown/__test__/stringify.test.ts` — "Markdown.stringify — the documented canonical form".
