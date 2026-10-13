---
type: Decision
title: github-actions errors are per-reason tagged unions, not one class with a reason field
description: ActionOutputError, BlobEnvelopeError, CacheKeyError and DetachedProcessError split into a union of classes rather than carrying a shared reason literal.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d43c9a5b235b78c9
---

# github-actions errors are per-reason tagged unions, not one class with a reason field

## Context

`@effected/github-actions` originally modelled a module's failure modes
as one error class carrying a `reason` string literal plus the one or two
fields whichever reason needed. `ActionOutputs`, `BlobEnvelope`,
`CacheKey` and `DetachedProcess` moved off that shape in favour of a
per-reason tagged union, while other modules in the same package remain
on the collapsed shape today.

## Decision

Split an error into a union of classes — one per reason — when the
reasons carry different fields, or when a caller plausibly recovers from
one reason alone. `ActionOutputError`, `BlobEnvelopeError`,
`CacheKeyError` and `DetachedProcessError` are all per-reason unions under
this test. Every exported *name* survives the split as a union type
alias (for example `CacheKeyError` is the union of its members), so no
signature changes and no consumer import breaks — a consumer that never
matched on `reason` never notices the split happened.

Under the split shape, every member carries exactly the fields its own
message needs, **non-optional**. Under the collapsed shape those fields
are all `optionalKey`, because different reasons need different fields on
one class, so a value constructed short a field is not a compile error —
it is a message that renders `"undefined"` at the exact moment someone is
reading logs to find out what broke. `ToolInstallerError.subject` being
required rather than optional is the same fix applied to a single field
rather than a full split.

`Effect.catchTag` can recover from one reason without catching the
others under the split shape; under the collapsed shape a caller
recovering from one reason has to write a `catchTag` plus an inner
`reason` check plus a re-fail, and the re-fail is the part that gets
forgotten.

An error whose reasons are a closed set over one shared field set stays
one class — there the discriminant *is* the whole information, and
splitting buys nothing but names.

## Alternatives rejected

**Split every error in the package uniformly, in one pass.** Rejected as
premature: the modules still on the collapsed shape are split candidates
by the same test as their own consumers grow, not before. `TarballError`
in `@effected/npm` is recorded as the same situation one package over —
the divergence is sequencing, not a second convention.

**Keep the collapsed shape and rely on documentation to warn about
optional fields.** Rejected because the failure mode is silent by
construction: a value constructed short a field is not a compile error,
so documentation cannot prevent the class of bug that a type-level split
prevents structurally.

## Consequences

A reader encountering a new error class in this package checks whether
its reasons share a field set before reaching for the collapsed shape by
default; a closed set over one shared field set stays one class, and a
set with per-reason fields or plausible partial recovery gets split from
the start rather than migrated later. The package carries both shapes
simultaneously by design during the transition, and a reviewer should not
read the collapsed modules as an oversight — they are split candidates
whose consumers have not yet demanded the split.
