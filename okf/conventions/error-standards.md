---
type: Convention
title: Error handling standards
description: The error-type preference order, where errors are defined, the Failure/Defect/Interrupt distinction, the rule that every declared error channel must be demonstrated fireable, and Effect.try in place of a hand-written try/catch inside Effect code.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-schema
    resource: ../../.repos/effect/packages/effect/src/Schema.ts
  - id: config-file-file
    resource: ../../packages/config-file/src/ConfigFile.ts
  - id: effect-try
    resource: ../../.repos/effect/packages/effect/src/Effect.ts
  - id: result-try
    resource: ../../.repos/effect/packages/effect/src/Result.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T22:03:44Z
integrity:
  generated:
    body: 45ed0a7278f3b77e
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
  error with a `cause: Schema.Defect()` field (the call, not the bare
  `Schema.Defect`, which throws at construction); never leak a raw `Error` as
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

## A throwing call inside Effect code goes through `Effect.try({ try, catch })`

When Effect code calls something that can throw (a fatal `TextDecoder`,
`new URL(...)`, `JSON.parse`), wrap the call in
`Effect.try({ try: () => ..., catch: (cause) => typedError(cause) })`.
Do not write a try/catch block that assigns to a `let` and then yields a
failure from the catch. `Effect.try` puts the throw straight into the
typed `E` channel, keeps the cause, and reads as one expression in a
`pipe` or a `yield*`.[^effect-try]

- Always pass the `{ try, catch }` form. The bare `Effect.try(thunk)`
  fails with `Cause.UnknownError`, which leaks an untyped error into the
  public channel.
- In pure code that already returns a `Result`, `Result.try` is the
  equivalent.[^result-try] Use it only where it reads better than the
  plain try/catch that builds `Result.fail` or `Result.succeed`. Leaving
  such a pure helper as it is is fine.
- For JSON text, decode through a Schema rather than wrapping
  `JSON.parse` (see the
  [input-hardening standards](input-hardening-standards.md#json-text-is-decoded-through-a-schema-never-parsed-and-cast)).

[^effect-schema]: `.repos/effect/packages/effect/src/Schema.ts` —
    `TaggedError` (line ~16646) and `Error` (line ~16585) constructors.
[^config-file-file]: `packages/config-file/src/ConfigFile.ts:21-125` —
    five `Schema.TaggedError` classes defined in the same module as the
    `ConfigFile` service.
[^effect-try]: `.repos/effect/packages/effect/src/Effect.ts` — `try_`,
    exported as `try`: the bare-thunk overload fails with
    `Cause.UnknownError`; the `{ try, catch }` overload gives `Effect<A, E>`.
[^result-try]: `.repos/effect/packages/effect/src/Result.ts` — `try_`,
    exported as `try`, the synchronous `Result` equivalent.
