---
type: Decision
title: A schema.org property gets one fixed arity, chosen toward many when uncertain
description: Every modeled property is either always a scalar or always an array, never a union of the two, and an uncertain case is modeled as an array because the two error costs are asymmetric.
status: stable
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 695d5298e6d46b8d
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 74416ec95c26878e
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# A schema.org property gets one fixed arity, chosen toward many when uncertain

## Context

schema.org permits nearly every property to hold either a single value or
an array of values interchangeably — the JSON-LD data model treats a
scalar and a one-element array of that scalar as the same thing. Modeling
that literally as `T | ReadonlyArray<T>` on every property is possible in
TypeScript, and `@effected/schema-org` had to decide whether faithfulness
to the vocabulary's flexibility was worth the type-level cost.

## Decision

Every modeled property is given exactly one shape: a property that
schema.org permits to repeat is `ReadonlyArray<T>` and always emitted as an
array, even at length one; a single-valued property is a scalar and always
emitted as a scalar. There is no `T | ReadonlyArray<T>` anywhere in the
surface, and no "collapse a one-element array to a scalar" convenience
option.

This is legal, not merely convenient, precisely because a value and a
one-element array of that value are identical in the JSON-LD data model —
every conforming processor reads them the same way. Fixing one shape per
property therefore gives up nothing expressible while gaining exactly one
representation per property, which is what makes a round-trip assertion or
a property test meaningful: there is one correct shape to check against
rather than two that are both "correct".

**Where arity is genuinely uncertain, the package chooses many.** The
error costs of guessing wrong are asymmetric: modeling a property as an
array when it turns out to only ever hold one value costs a caller one
extra pair of brackets at each call site. Modeling it as a scalar when it
turns out some real document needs several is a breaking change — the
field's type must widen, and every consumer's code that assumed a scalar
breaks. `publisher` is modeled as an array on exactly this reasoning, even
though a single publisher is the overwhelmingly common case.

A collapse to scalar is not banned outright — `mainEntity`, `name`,
`headline`, `version`, `datePublished` and their kin are scalars — but each
carries a justification on the member's own TSDoc naming whose collapse it
is. `mainEntity` is singular by schema.org's own vocabulary definition,
which is not this package's call to revisit; the others are singular by
nature and are the rows a later modeling round may reconsider if a real
document needs otherwise.

Where a property is genuinely one-or-many, there is deliberately no
singular convenience accessor: the many case is unmissable, on the same
never-pick-a-representative reasoning `@effected/spdx`'s `licensesOf` /
`primaryLicense` pair established.

## Alternatives rejected

**Modeling every ambiguous property as `T | ReadonlyArray<T>`.** Rejected
because it produces a union that typechecks against everything and tells
the author nothing — every call site would need to normalize before doing
anything useful with the value, pushing the normalization decision onto
every consumer instead of making it once, correctly, in the vocabulary
package.

**Defaulting uncertain properties to scalar, widening to array only when a
real document is found needing it.** Rejected because widening a scalar to
an array is the more expensive direction — a breaking change for every
consumer who wrote `node.publisher.name` against a scalar type — while the
reverse mistake (an array around a value that is always singular) costs
nothing more than an extra pair of brackets. Choosing many by default when
uncertain avoids ever needing the expensive correction.

**Providing an optional singular-accessor helper that collapses an array to
its first element for caller convenience.** Rejected on the same grounds
as `@effected/spdx`'s `primaryLicense`: a convenience accessor that
silently picks the first of several values produces a confidently wrong
answer for any document that actually uses more than one, and the
information loss is invisible at the call site.

## Consequences

Adding a new node class or a new field to an existing one requires
checking schema.org's own cardinality note for that property and, when it
is ambiguous, defaulting to an array with a TSDoc note recording that the
choice erred toward many. Widening an existing scalar property to an array
remains available as a fix but is a breaking change and must be flagged as
one; narrowing an array to a scalar is not available at all without
removing information a real document might carry.
