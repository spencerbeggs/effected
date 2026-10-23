---
type: Decision
title: "templates owns the mechanism, never the content"
description: Why @effected/templates carries no vendor naming, section vocabulary, or file-ordering policy of its own.
status: stable
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e09427cf7ba1cda6
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: ec18ec9e1801c788
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# templates owns the mechanism, never the content

## Context

A managed-section engine could plausibly ship with some batteries
included — a preset set of section ids for common tools, an opinion about
which files carry which sections, or vendor-specific naming baked into the
marker phrase. `@effected/templates`' first in-kit consumer,
`@effected/github-actions`'s `ManagedDocument`, needed exactly one thing
from the mechanism: a `SectionDocument` with its parameters *fixed* — HTML
comment style, a `MANAGED REGION` phrase, namespaced wire keys — not a
second engine and not an extended one.

## Decision

`@effected/templates` owns marker syntax, parsing, reconciliation, comment
styles as a parameterized set, and file IO. It owns no vocabulary: what a
section's content says, which files carry sections and in what order, and
what the section keys are called all belong to the consumer. No vendor
naming appears anywhere in the package — the default marker phrase is
`MANAGED SECTION` and the doc examples use `example-tool`. A "shell section
definition" is not a shell abstraction inside this package; it is a
section id with `commentStyle` pre-bound to `#`, one `const` at a
consumer's call site.

When `@effected/github-actions` later needed marker attributes — a run
stamp readable from the marker line without opening the block — the
mechanism absorbed it as marker syntax plus an equality rule, while the
*meaning* of the attribute pairs, including which keys constitute a stamp,
stayed entirely with the consumer. That is the mechanism-versus-content
line holding under pressure from a real second ask, rather than holding by
assertion alone.

## Alternatives rejected

- **Baking vendor-specific section ids or naming into the package.**
  Rejected because it would freeze one consumer's vocabulary into a
  mechanism every future consumer has to route around.
- **Extending the dialect's parameters for the Actions consumer's needs**
  (a fourth comment style variant, a hardcoded phrase). Rejected because
  the consumer only ever needed the existing parameters narrowed to fixed
  values, never a wider dialect surface — extending would have been
  solving a problem nobody had.
- **Encoding the run-stamp meaning as package-level content vocabulary.**
  Rejected because the mechanism's job stops at "the block can carry
  metadata a later run can read without opening it"; deciding what that
  metadata means is domain logic that belongs to the consumer holding the
  domain.

## Consequences

Any future ask that looks like "teach the package about tool X" should be
read first as a call site concern — a section id with a fixed comment
style, declared where the consumer lives — and only escalated to a package
change if the mechanism itself is missing a capability (a comment style
shape it cannot represent, a reconciliation rule it enforces wrongly).
`@effected/templates` stays reusable across every consumer precisely
because it never remembers whose block it just rewrote.
