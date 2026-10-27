---
type: Convention
title: Error handling standards
description: The error-type preference order, where errors are defined, the Failure/Defect/Interrupt distinction, the rule that every declared error channel must be demonstrated fireable, Effect.try in place of a hand-written try/catch inside Effect code, and the one guarded, never-throwing cause-message read every error that renders a preserved cause copies verbatim.
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
  - id: effect-predicate
    resource: ../../.repos/effect/packages/effect/src/Predicate.ts
  - id: store-cause-message
    resource: ../../packages/store/src/internal/causeMessage.ts
  - id: store-lifecycle-test
    resource: ../../packages/store/__test__/StoreLifecycle.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: e5885369f2be1817
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

## An error that renders a preserved cause reads it through the one guarded `causeMessage`

A `cause: Schema.Defect()` field holds whatever was thrown: an `Error`, an
`Error` from another realm (which fails `instanceof Error`), a plain
`{ message }` object, a string, or nothing useful. A `message` getter that
splices the cause's text therefore reads it through `Predicate.hasProperty`
and `Predicate.isString`,[^effect-predicate] never `instanceof Error`, and
treats an empty or whitespace-only message as none. The read walks `cause`
links and joins every distinct message it finds, nearest first, with a colon and a space,
because a wrapper's text is often the generic summary and the text underneath
is the actionable detail (a `SqlError` says "Failed to prepare statement";
SQLite, one link down, says "no such table: t", and the error renders
both),[^store-lifecycle-test] yet a wrapper that composes its own context
(a remediation such as "run pnpm add --config x") must not lose it either.
Neither innermost-wins nor nearest-wins keeps both, so the join is the one
shape. Its two rules: a deeper text the accumulated message already contains
is skipped, so a wrapper that spliced its cause's text does not repeat it;
a deeper text that contains the accumulated message replaces it. The walk is
bounded so a cyclic chain terminates. Every property read is guarded: a
`message` getter (or proxy trap) that throws leaves that link without text, and
a `cause` getter that throws ends the walk with what was found, so the helper
never throws.

The helper is `src/internal/causeMessage.ts`, copied verbatim into every
package that renders a cause, rather than imported: no pure zero-dependency
kit package is a regular dependency of every site, and a package with no
`@effected` edge (`images`, `jsonl`, `memfs`) would otherwise gain one for a
forty-line function. `@effected/store` carries the reference
copy.[^store-cause-message] Change the shape there and in this section first,
then re-copy; a site-local variant (an `instanceof Error` read, a different
empty-message rule, a different depth) is a defect to converge, not a
dialect. The module is:

```ts
import { Predicate } from "effect";

/** How many nodes of a cause chain the walk reads before stopping, so a cyclic chain cannot spin. */
const CAUSE_DEPTH = 8;

/**
 * The message a single node carries: a thrown string, or a non-empty string `message` property. A getter or
 * proxy trap that throws is a node with no message.
 */
const messageAt = (node: unknown): string | undefined => {
  try {
    const text = Predicate.isString(node)
      ? node
      : Predicate.hasProperty(node, "message") && Predicate.isString(node.message)
        ? node.message
        : undefined;
    return text === undefined || text.trim() === "" ? undefined : text;
  } catch {
    return undefined;
  }
};

/** The next link of the chain: a node's `cause`, or `undefined` when it has none or reading it throws. */
const causeAt = (node: unknown): unknown => {
  try {
    return Predicate.hasProperty(node, "cause") ? node.cause : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Every distinct non-empty message a preserved cause chain carries, nearest
 * first and joined with `: `, or `undefined` when nothing along it has one.
 *
 * A `Schema.Defect()` field holds whatever was thrown, so the read is guarded
 * rather than assumed: `Predicate.hasProperty` + `Predicate.isString` accepts
 * an `Error`, a cross-realm `Error` that fails `instanceof`, a plain
 * `{ message }` object and a thrown string alike. An empty or whitespace-only
 * message counts as none. The walk follows `cause` links because a wrapper's
 * text is often the generic summary and the driver's text underneath is the
 * actionable detail, yet a wrapper that composes its own context must not
 * lose it either; so nothing is dropped, and a deeper text the nearer one
 * already contains is not repeated. The walk is bounded, so a cycle terminates.
 *
 * It never throws: every property read is guarded, so a `message` getter that throws leaves that link
 * without text, and a `cause` getter that throws ends the walk with what was found so far.
 */
export const causeMessage = (cause: unknown): string | undefined => {
  let message: string | undefined;
  let node: unknown = cause;
  for (let depth = 0; depth < CAUSE_DEPTH && node !== undefined && node !== null; depth++) {
    const text = messageAt(node);
    if (text !== undefined) {
      if (message === undefined || text.includes(message)) message = text;
      else if (!message.includes(text)) message = `${message}: ${text}`;
    }
    node = causeAt(node);
  }
  return message;
};
```

The shipped copies carry the same text under the kit's tab indentation and a
leading comment naming this section as the source; `cmp` across
`packages/*/src/internal/causeMessage.ts` must report them identical. There
are nine, every one with the getter guards above: `@effected/cli`,
`images`, `jsonc`, `jsonl`, `npm`, `package-json`, `schemastore-cli`,
`store` and `workspaces`. `@effected/cli` is the one that also publishes
it, as `Fmt.causeMessage`, the read a consumer's own error rendering should
use instead of copying the module (see [`cli.md`](../modules/cli.md)).

- The helper returns `string | undefined`; the site decides the fallback.
  A `message` getter renders its summary alone when `causeMessage` returns
  `undefined`, and `summary: detail` otherwise, rather than printing
  `undefined` or `[object Object]`. A site that must produce a string for
  splicing names its own fallback: `?? String(cause)`, or a constant such as
  `"value is not JSON-serializable"`.
- A site that needs more than the message (the schemastore CLI prefers an
  import failure's `stack`, which names the module and line that threw)
  reads that property through the same `hasProperty` + `isString` guard and
  falls through to `causeMessage`.
- Every copy ships with the same `__test__/causeMessage.test.ts`: a plain
  `{ message }` object, an empty and a whitespace-only message, a thrown
  string, a chain joined nearest first, a chain whose nearer node already
  splices the deeper text (not repeated), a deeper text that contains the
  nearer one (replaces it), a chain whose deeper nodes are empty, a cycle,
  a message past the depth bound, and a throwing `message` getter, a throwing
  `cause` getter and a throwing getter deep in the chain (each yields the
  partial text, never a throw).
- Two site-local `instanceof Error` reads remain in `@effected/schemastore-cli`
  outside the sites #1082 named, `src/AjvValidator.ts` (the ajv compile
  catch) and `src/cli/commands/validate.ts` (the `JSON.parse` catch); both
  are pending convergence onto the package's `causeMessage` copy.
  `@effected/jsonc`'s `JsoncFingerprint.ts` (the thrown-digest catch)
  converged in the same wave and carries its own copy. The other
  `instanceof Error` reads in the kit sit outside this rule's subject — they
  render a value caught at a boundary, a defect's stack or an `Error`'s
  identity, not a preserved `cause: Schema.Defect()` field — and are listed
  so the inventory is complete, not as debt: in `@effected/cli`
  `src/CliRuntime.ts`, `src/CliFailure.ts`, `src/ui/CliUiLive.ts`,
  `src/ui/internal/inkConsole.ts` and `src/internal/fileSink.ts`;
  `@effected/engine`'s `src/ProcessGuard.ts`; and `@effected/github-actions`'
  `src/Action.ts`. Of the message-from-`cause` sites #1082 named, the one
  read that stays is `REPLAY_SCRIPT` in
  `packages/workspaces/src/ConfigDependencyHooks.ts`: it is JavaScript source
  text run in a bare `node` subprocess with no `effect` on its module path,
  so it cannot import `Predicate`; the parent decodes its serialized failure
  through a `Schema` and rebuilds it as an `Error`, so every render downstream
  of it goes through the guarded helper.

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
[^effect-predicate]: `.repos/effect/packages/effect/src/Predicate.ts` —
    `hasProperty` (`isObjectKeyword(self) && property in self`) and
    `isString`, the two guards the read is built from.
[^store-cause-message]: `packages/store/src/internal/causeMessage.ts` — the
    reference copy of the helper.
[^store-lifecycle-test]: `packages/store/__test__/StoreLifecycle.test.ts` —
    `StoreError.message carries the cause`: the direct cause's own message is
    "Failed to prepare statement" and the rendered text is "Store setup
    failed: Failed to prepare statement: no such table: no_such_table".
