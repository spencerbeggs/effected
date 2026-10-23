---
type: Decision
title: Each format package keeps its own options type
description: No shared kit-wide formatter options shape; each package's options stay irreducibly format-specific.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b71add744643e74d
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: fca1d94c0144e5a3
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Each format package keeps its own options type

## Context

With five format packages converging on a shared `*Format`/`formatToString`
naming and shape (see [format-naming](format-naming.md)), the question arose
whether their formatting options should also share a common type, the way
the entry-point names do.

## Decision

Each package keeps its own options type (`JsoncFormattingOptions`,
`YamlFormattingOptions`, `TomlFormattingOptions`,
`MarkdownFormattingOptions`). No shared kit-wide formatter options shape
exists or is planned.

What the decision does mandate is documentation discipline: where a tolerant
options member's default differs from its strict counterpart, the divergence
and its reason are documented on the member — for example an indentation
default of `"preserve"` because reformatting in place should not silently
restyle a file, or a strip-empty default of `false` because an empty map is a
key the author actually wrote. Divergent defaults are exactly where a silent
edit hides, so the documentation obligation is the enforcement mechanism in
place of a shared type.

## Alternatives rejected

**A shared kit-wide options type.** Rejected on two grounds. First, the
options are irreducibly format-specific: a shared type is either a lowest
common denominator that constrains every package, or a union carrying
members meaningless to most of them. Second, a shared options type is a
cross-package coupling that has to live somewhere — every package would take
a dependency edge on whichever package owned it, for a type alias, and the
kit's acyclic-dependency rule's usual answer (introduce a third package to
own the shared shape) does not earn its slot for a handful of optional
booleans.

**Collapsing a package's value-path and text-path options into one type.**
Rejected because a package carrying both a value-path and a text-path
options type is correct, not duplication — a `sourceText` member is
meaningless on the value path, and the defaults deliberately differ between
the two paths. Collapsing them requires either a member ignored half the
time or a default wrong half the time.

## Consequences

A consumer reading `YamlFormattingOptions` learns nothing about
`TomlFormattingOptions` from having read it, and that is intended: each
package's options are reviewed against its own document model, not against a
kit-wide contract. A new divergent default is a documentation-completeness
review item, not a type-design review item.
