# The typed-channel invariant: input versus callbacks

> Malformed input fails through the documented typed error channel
> (`Effect<_, DomainError>`), NEVER as an unhandled defect.

## Keeping the engine from throwing

Any `throw` inside the engine that the facade does not catch-and-materialize
is a defect leak. Keep the engine facade-free: it emits raw records and the
facade builds the typed error, so the engine's job is to *return* an error
record or error token, not throw. Where a throw is unavoidable on a hot path
(e.g. a circular-reference guard), throw a dedicated internal error class and
have the facade `Effect.try({ catch })` it into the domain error.

Test it the right way:

```ts
const error = yield* Effect.flip(Yaml.parse(hostileInput));
assert.strictEqual(error._tag, "YamlParseError");        // typed, not a defect
// or, to prove it is not a defect at all:
const r = yield* Effect.result(Yaml.parse(hostileInput)); // never throws
assert.strictEqual(r._tag, "Failure");
```

A `try/catch` around `Effect.runSync` that catches a `RangeError` is the smell
this skill exists to eliminate — that is a defect that reached the caller.

## Scope: this governs INPUT, not caller-supplied callbacks

The invariant is about **data crossing the boundary**. It does **not** extend to
callbacks the caller hands you that already declare an `Effect` error channel —
a migration step's `up: (raw) => Effect<unknown, E>`, a `validate` hook, a
`VersionAccess.get`. Those are *producers* with a typed channel of their own.

**A `throw` from one of them is a contract violation — a programmer bug, not a
data condition — and must stay a defect.** Do not `try/catch` a user callback
into a typed error. If you do, the consumer's `catchTag("MigrationError")`
silently swallows their own null-deref and carries on with a half-migrated
config. Effect's defect/failure split exists precisely to keep those apart, and
the library cannot tell a typo from a data condition — which is why the *author*
declares intent by calling `Effect.fail`.

The distinction that decides it: **does the callback's result participate in the
operation's result?**

| callback | result used? | a `throw` should be |
| --- | --- | --- |
| `options.validate` — its return value is handed back to the caller | yes | a **defect** |
| a migration's `up` — its output becomes the config | yes | a **defect** |
| an `emit` / observability hook — result discarded (`Effect<void>`) | no | **absorbed** (`Effect.catchDefect`), and logged |

`Effect.try` / `Effect.tryPromise` around a *host* function stays correct —
`JSON.parse`, `crypto.subtle.decrypt`, `fs.readFileString`. Those have no channel
but a throw or a rejection. That is not analogous to a callback that has one and
declined to use it.

One more trap: guarding only the *synchronous construction* of a callback's
effect catches the least idiomatic way to write it. `Effect.suspend(run)`
normalizes a construction-time throw into the same defect channel as a throw
inside `Effect.sync` or `Effect.gen`, so all shapes behave identically. Anything
narrower routes the same bug to the typed channel or the defect channel
depending on an invisible detail of how the caller built their effect.
