---
type: Decision
title: The MDX brace escape is presence-keyed, never a stringify option
description: A tree carrying any MDX node additionally escapes { in text; the escape is triggered by a pre-scan of the tree, never by a caller-set option.
status: stable
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5cc451799c6528e0
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 254bc67c8099f42e
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The MDX brace escape is presence-keyed, never a stringify option

## Context

MDX makes `{` a significant character in text — it opens an expression
anywhere — so a tree carrying an MDX node needs the stringifier to escape it,
where a plain-markdown tree does not. `Markdown.stringify` takes no options
at all, and its output is documented as byte-stable, asserted row-by-row by
a canonical-form test suite. Adding MDX support without breaking that
byte-stability guarantee, or forcing every plain-markdown caller to learn a
new option, required a decision about how the escape activates.

## Decision

The escape is presence-keyed: an iterative, deliberately unguarded pre-scan
(`treeContainsMdx`) checks whether the tree carries any MDX node, and that
result gates the one added escape branch in `escapeText`. A tree with no MDX
node serializes byte-identically to the published canonical-form table; a
tree containing any MDX node additionally escapes `{` in text. No caller
ever sets a flag.

## Alternatives rejected

**A stringify option, such as `{ mdx: true }`.** Rejected because it would
force every caller — including the entire plain-markdown consumer base whose
byte-stability guarantee the canonical-form table exists to make — to know
about and correctly set an option that has nothing to do with their use
case. Presence-keying makes the two audiences (plain markdown, MDX) mutually
invisible to each other's concerns: a plain-markdown caller never needs to
know MDX escaping exists, and an MDX-tree caller never needs to remember to
turn it on.

## Consequences

`Markdown.stringify` stays genuinely option-free, which is itself part of
the package's published commitment. Adding a new MDX node type in the future
must keep it flowing through the same presence pre-scan rather than
introducing a second signaling mechanism, or the corpus-wide re-parse
equivalence property covering plain-markdown trees would need re-verification
against a new code path it was never exercising before.
