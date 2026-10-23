---
type: Decision
title: primaryLicense returns none for an AND expression rather than guessing a term
description: A conjunctive SPDX expression has no single license it can honestly be said to be under, so the accessor declines instead of picking the leftmost or any other conjunct.
status: stable
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8f9a4cb5d4fc60ef
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: e0d33d4a9b834827
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# primaryLicense returns none for an AND expression rather than guessing a term

## Context

`@effected/spdx`'s `SpdxExpression.primaryLicense` (`src/SpdxExpression.ts:351`)
answers "which single license is this expression under" for a caller that
needs one license rather than a set — a UI field, a report row. A simple
license, a `WITH`-qualified license, and an `OR` expression all have a
defensible single answer. An `AND` expression does not, and the accessor
had to decide what to return for it rather than leave the case unhandled.

## Decision

`primaryLicense` returns `Option.none()` for every `AND` expression,
regardless of how many terms it conjoins or how the terms are ordered. `OR`
yields the leftmost term — the choice its author wrote first, matching
npm's own convention for a preferred license — but `AND` never yields any
term at all.

**The `AND` → `none` mapping is a routing signal, not an error.** A
conjunction means every term binds at once: the software is under this
license *and* that one, simultaneously, in full. No single term represents
that state, and picking one — even the first, even the "primary-looking"
one — would silently drop a term that legally applies. A confidently wrong
single answer is worse than an absent one, because it looks like a
complete answer to a caller who has no way to tell it isn't. The caller is
expected to carry `licensesOf` (the ordered, de-duplicated array
accessor) alongside `primaryLicense` and fall back to the array whenever
the scalar comes back `none`.

## Alternatives rejected

**Returning the leftmost conjunct, mirroring the `OR` behavior.** Rejected
because leftmost-for-`OR` and leftmost-for-`AND` mean different things: an
`OR`'s leftmost term is a legitimate single license the software may be
used under, while an `AND`'s leftmost term is only *one part* of the
license the software is actually under. Returning it would present a
partial obligation as if it were the whole one.

**Returning the license with the most restrictive terms, or some other
"dominant" term heuristic.** Rejected as unstateable and unstable: SPDX
expressions carry no restrictiveness ordering, any heuristic would need
external license-comparison data this package does not have, and a
heuristic answer is exactly the "confidently wrong" failure mode the
`none` mapping exists to avoid.

**Throwing or failing typed on `AND`.** Rejected because an `AND`
expression is not malformed input — it is a completely valid SPDX
expression that the accessor's contract (produce a single scalar) simply
cannot honor. `Option.none()` reports that honestly within the accessor's
own return type, rather than forcing every caller into an error-handling
path for legal input.

## Consequences

A caller of `primaryLicense` must handle `none()` as "this expression has
no single license" and consult `licensesOf` for the full set, rather than
treating `none` as an edge case to paper over with a fallback term. Any
future accessor added to `SpdxExpression` that collapses a many-license
expression to one value must apply the same rule: decline via `Option.none`
rather than choose, whenever choosing would drop a term that legally
applies. See [the licensing accessors in the spdx
Module](../modules/spdx.md#reading-licenses-out-of-an-expression).
