# Errors and causes — the cases past the everyday recovery

The recovery family beyond `catchTag`, what a typed error class should carry,
an error that leaks its input, and how a `Cause` behaves when failures and
defects meet.

## `Effect.catch` lets defects through — and a `never` channel hides them

`Effect.catch` recovers typed failures ONLY. `Effect.fail("x").pipe(Effect.catch(h))`
succeeds with the handler's value, while the same pipe on `Effect.die` and
`Effect.interrupt` exits `Failure` with the `Die`/`Interrupt` reason intact.

The corollary bites in code whose error channel is later declared `never`: a
bare `JSON.parse` (or any throwing host call) inside such a function is a
**defect**, so no downstream `Effect.catch` will absorb it — it escapes through
the `never` channel. Wrap the throwing call locally (`try/catch` or
`Effect.try`) at the point it can throw; do not assume a catch further out has
you covered.

## Recovering a nested `reason`

Recover a nested `reason` without stripping the parent error from the channel
(e.g. an `AiError` whose `reason` is a `RateLimitError`):

```ts
someAiCall.pipe(
  Effect.catchReason("AiError", "RateLimitError", (reason) =>
    Effect.sleep(reason.retryAfter)
  )
)
```

`Effect.catchReasons("AiError", { RateLimitError: h1, AuthError: h2 })` handles
several reason tags at once; `Effect.catchEager(handler)` is the optimization
variant of `catch` that runs synchronous recovery immediately.

## `Schema.Defect()` is for a foreign failure; typed fields describe a known one

`cause: Schema.Defect()` is **only** for wrapping an *unknown throwable* you
caught. It is the wrong tool for a **synthetic domain error** you raise yourself
from structured data (e.g. a navigation mismatch carrying `expected`/`depth`, or a
validation failure with a known shape). There, the fix for a `reason: string`
that flattens discriminating data is to **promote that data to typed fields** and
keep `reason` as the human `message` — not to add a `Defect`.

Failing through this typed channel — never letting a `throw` escape as an
unhandled defect — is the invariant the `hardening-a-parser-port` skill
enforces.

## Core's `EncodingError` carries the whole decoder input

`Base64.decode`, `Base64Url.decode` and `Hex.decode` (`effect/encoding`) return
`Result<Uint8Array, EncodingError>`, and `EncodingError` is a `Data.TaggedError`
whose fields are `kind`, `module`, `message` and `input: unknown` — `input` is
the **entire string being decoded**. The constructor assigns it as an ordinary
own property and `toJSON` spreads it, so it rides along into `JSON.stringify`,
`util.inspect`, `Cause.pretty`, and any typed error or event payload that keeps
the core error by identity. When the input may be a secret — an encrypted
envelope, a token, a key, a config file that turns out to be plaintext — never
keep the core `EncodingError` as a `cause`. Map it to a message-only error at
the decode site, or copy the fields you need and drop `input`. The messages
name a length or one offending character, never the input, so `message` alone
is safe to keep:

```ts
import * as Base64 from "effect/encoding/Base64"

const decodeSecret = (raw: string) =>
  Effect.mapError(Effect.fromResult(Base64.decode(raw)), (error) => {
    const cause = new Error(error.message) // keeps `message`, drops `input`
    cause.name = error._tag
    return new SecretDecodeError({ cause })
  })
```

## Inspecting a `Cause`

The reason-level guards and cause-level predicates:

- Reason guards: `Cause.isFailReason` / `isDieReason` / `isInterruptReason`.
- Cause predicates: `Cause.hasFails` / `hasDies` / `hasInterrupts`.
- Extraction returns `Result` or `Option`: `Cause.findError` (Result),
  `Cause.findErrorOption` (Option), `Cause.findDefect`.
- Merge causes with `Cause.combine` — the sequential/parallel distinction is
  gone (it concatenates reasons).

## A defect beside a typed failure turns the failure into a defect

When the runtime combines a typed failure with a defect — a finalizer that dies
while a `Fail` is unwinding through its scope, or a sibling that dies — defects
take precedence and the typed failure is **demoted to a `Die`** carrying the
same value:

```ts
const program = Effect.scoped(Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.die(new Error("finalizer failed")))
  return yield* Effect.fail(new Cancelled())
}))
// reasons: Die(Cancelled), Die(Error: finalizer failed) — no Fail left
```

So `Effect.catchTag("Cancelled", ...)` does not run, which is the point: typed
recovery cannot swallow a crash. Code that sorts a cause by reason kind must
expect its own error class among the `Die` reasons. Filter it out by class when
"the other defects" is what you mean, and look for it in `Die` reasons too when
asking "was this cancelled".

## Probing `catchCause` — the obvious experiment lies

`Effect.catchCause`'s handler **does not run** when a fiber suspended in
`Effect.never` is interrupted externally; it **does** run on an interrupt cause
flowing through the chain (`Effect.interrupt`). The natural probe for "does
`catchCause` swallow interrupts?" is the former and returns the wrong answer.
Probe with `Effect.interrupt.pipe(Effect.catchCause(h))` — the handler runs,
`Cause.hasInterrupts(c)` is `true`, and the effect **succeeds**. It swallows
interruption. That is almost never what you want.
