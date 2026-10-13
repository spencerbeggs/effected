---
type: Convention
title: Error handling standards
description: The error-type preference order, where errors are defined, the Failure/Defect/Interrupt distinction, and the rule that every declared error channel must be demonstrated fireable.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-schema
    resource: ../../.repos/effect/packages/effect/src/Schema.ts
  - id: config-file-file
    resource: ../../packages/config-file/src/ConfigFile.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 59f4bba2dcf2ce24
---

# Error handling standards

- Preference order: `Schema.TaggedError` (default — schema-backed, `_tag`
  routing, serializable, yieldable)[^effect-schema] →
  `Schema.Error` (schema-backed, no tag matching; infrastructure
  errors)[^effect-schema] → `Data.TaggedError` (fallback, reserved for
  truly local in-memory-only failures with non-serializable payloads).
- Errors are defined in the module file of the concept that raises them
  (see [module-per-concept layout](module-per-concept-layout.md)), never
  in a central `errors/` directory. `@effected/config-file`'s
  `ConfigFile.ts` defines `ConfigFileNotFoundError`,
  `ConfigFileReadError`, `ConfigFileWriteError`,
  `ConfigDefaultPathMissingError` and `ConfigValidationError` in the same
  module as the `ConfigFile` service that raises them.[^config-file-file]
- Three failure modes stay distinct: Failure (the typed `E` channel —
  expected, recoverable), Defect (`Cause.Die` — invariant violations,
  programmer error), and Interrupt (cooperative cancellation). Never
  model an expected business failure as a defect; reach for `orDie` only
  when the failure is validated as unrecoverable, and never to silence a
  type error.
- Wrap a foreign (third-party or runtime) error in a typed schema-backed
  error with a `cause: Schema.Defect` field; never leak a raw `Error` as
  part of a public contract.
- Normalize `SchemaError` to a domain error at the boundary via
  `Effect.catchTag("SchemaError", ...)`; never let `SchemaError` leak
  deep into application logic.
- Recovery operators: `catchTag` / `catchTags` for tagged recovery,
  `catchIf` for predicates, `match` to fold, `sandbox` / `catchCause` /
  `matchCause` to distinguish failure from defect from interrupt,
  `onInterrupt` for cleanup.
- Keep `_tag` names stable and descriptive; never collapse an error to
  `string` or `unknown` early.

## Every declared error channel is demonstrated fireable by a test, or deleted from the signature

A channel that cannot fire forces every caller to handle a case that does
not exist, and makes the type lie in the one direction the compiler
cannot check. Ported code is where these accumulate: a can't-fire channel
is typically a residue of something the port changed underneath it — a
validated construction that made formatting total, or an owned emitter
that removed the library whose failures the channel used to model. Treat
an error case with no failing test as a defect to fix, not a case to
leave documented for a future caller.

[^effect-schema]: `.repos/effect/packages/effect/src/Schema.ts` —
    `TaggedError` (line ~14201) and `Error` (line ~14141) constructors.
[^config-file-file]: `packages/config-file/src/ConfigFile.ts:21-103` —
    five `Schema.TaggedError` classes defined in the same module as the
    `ConfigFile` service.
