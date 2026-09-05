---
name: effect-v4-idioms
description: >-
  Use when writing core Effect v4 code — generators (Effect.gen/Effect.fn), typed error handling
  and recovery (catch/catchTag/catchFilter/catchReason), yieldable errors, PlatformError on
  FileSystem/Path IO, Cause inspection, Scope and resource cleanup, forking and fibers,
  runtime/entrypoints, FiberRef-as-Context.Reference, and structural equality. Teaches the
  idiomatic v4 spelling. Every identifier and source citation re-verified against
  effect@4.0.0-rc.109.
---

# Effect v4 core idioms

The idiomatic way to write core v4 code — generators, errors, resources, fibers,
runtime, equality. For *which module* to reach for in the first place (what is
`Sink`, `RcMap`, `Latch`…), consult `effect-v4-module-index` — this skill owns
patterns, not the map. For confirming that a name exists before you rely on it,
see `effect-v4-source-lookup`. Every identifier below was verified to exist against
`effect@4.0.0-rc.109`, and every `file:line` citation re-checked against the
vendored tree at that tag; when you reach past this list, run one runtime probe
(`node --input-type=module -e "import * as Effect from 'effect/Effect'; console.log(typeof Effect.X)"`)
before writing — v4 betas move fast and muscle memory lies.

## Generators — `Effect.gen` for workflows

`Effect.gen(function*() { ... })` is unchanged for the common case. Reach for it
when a block *orchestrates*: multiple `yield*`, branching, reading several
services, implementing a layer or handler.

The one change bites service methods: a generator that needs `this` no longer
takes the bare `this` argument. Pass it in an options object:

```ts
class Counter {
  readonly step = 1
  // v4: self lives in an options object, NOT Effect.gen(this, fn)
  next = Effect.gen({ self: this }, function* () {
    return yield* Effect.succeed(this.step + 1)
  })
}
```

## `Effect.fn` for reusable operations

A parameterized operation you call from several places is `Effect.fn`, not an
inline `Effect.gen`:

```ts
const loadUser = Effect.fn("loadUser")(function* (id: string) {
  const row = yield* db.query(id)
  return decode(row)
})
```

- `Effect.fn("name")(function* …)` — named span **and** clean stack frames; use
  at public/business operation boundaries so traces and errors carry the name.
- `Effect.fn(function* …)` — bare, no name: still gets the stack-frame
  ergonomics without minting a named span. Use inside a module where the span
  would be noise.
- `Effect.fnUntraced(function* …)` — escape hatch only (low-level internals, or
  a deliberate tracing trade-off). Not a default.

Split rule: reusable parameterized operation → `Effect.fn`; one-off inline
workflow → `Effect.gen`.

**`Effect.fn` is not generator-only.** A plain function that *returns* an Effect
both runs and typechecks (probed beta.94):

```ts
const double = Effect.fn("double")((n: number) => Effect.succeed(n * 2))
```

Reach for it when the body has nothing to `yield*` — you still get the named span
and the stack frames, without a generator wrapping a single expression. The
generator is the common case, not a requirement.

Two semantics of the plain-function form worth stating, both probed at
beta.98: the body is **lazy** — it runs when the returned effect is *executed*,
not when `double(21)` is called (calling the wrapped function only constructs
the effect); and a **`throw` from the body becomes a `Die` defect**, not a
typed failure — the plain form gives you no typed error channel for free, so a
body that can throw belongs in `Effect.try`, or the throw escapes as a defect.

## Wrapping a callback API — `Effect.callback`

Wrapping a callback API is **`Effect.callback`**. There is no `Effect.async` —
the name resolves to `undefined`, so reaching for it fails at the call site with
a "not a function" that points nowhere near the cause.

## Error handling — `catch*` recovery

The recovery family is spelled `catch*`, with `Filter` and `Reason` variants.
The idiomatic recoveries:

- **`Effect.catchTag(tag, handler)` / `Effect.catchTags({ Tag: handler })`** —
  targeted typed recovery, both unchanged. Default choice for domain errors.
  `catchTag` also accepts a non-empty tag ARRAY sharing one handler —
  `Effect.catchTag(["UnknownRefError", "GitCommandError"], () => fallback)` —
  which obviates `catchTags` boilerplate when several tags route to the same
  recovery (verified at rc.109, `Effect.ts:2695` `Arr.NonEmptyReadonlyArray<Tags<E>>`).
- **`Effect.catch(handler)`** — recover from any typed failure; there is no
  `catchAll`. **`Effect.catchCause(handler)`** for full-cause infra handling,
  **`Effect.catchDefect(handler)`** for defects.
- **`Effect.match({ onFailure, onSuccess })`** — totalize an effect to a plain
  value when you want no failure channel left.

Selective recovery now takes a `Filter`, not an `Option`-returning predicate:

```ts
import { Effect, Filter } from "effect"

Effect.fail(42).pipe(
  Effect.catchFilter(
    Filter.fromPredicate((e: number) => e === 42),
    () => Effect.succeed("caught")
  )
)
```

Use `Effect.catchCauseFilter` for the cause-level equivalent.

**`Effect.catch` recovers typed failures ONLY — defects and interrupts pass
straight through.** Probed on beta.94: `Effect.fail("x").pipe(Effect.catch(h))`
succeeds with the handler's value, while the same pipe on `Effect.die` and
`Effect.interrupt` exits `Failure` with the `Die`/`Interrupt` reason intact.
The corollary bites in code whose error channel is later declared `never`: a
bare `JSON.parse` (or any throwing host call) inside such a function is a
**defect**, so no downstream `Effect.catch` will absorb it — it escapes through
the `never` channel. Wrap the throwing call locally (`try/catch` or
`Effect.try`) at the point it can throw; do not assume a catch further out has
you covered.

## `PlatformError` — the error type of core IO

Core `FileSystem` / `Path` operations fail with `PlatformError`, and its shape
is not guessable: `effect` re-exports the module **as a namespace**
(`export * as PlatformError from "./PlatformError.ts"`, index.ts:402) and the
error **class** is declared inside it (PlatformError.ts:157, a
`Data.TaggedError("PlatformError")`). So the type you write is the doubled
`PlatformError.PlatformError`:

```ts
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

const isGitRoot = (
  dir: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.exists(path.join(dir, ".git"));
  });
```

Written once it looks like a typo — which is exactly why it gets replaced with
`unknown`. Do not: typing a `FileSystem`-backed channel `unknown` violates the
house standard (never collapse errors to `string`/`unknown` early) when the
precise type is one `import type` away. `fs.exists: (path: string) =>
Effect.Effect<boolean, PlatformError>` (FileSystem.ts:143) — verified against
rc.109. The `reason` field is where the detail lives: a `PlatformError` wraps
a `BadArgument` (rejected caller input) or a `SystemError` (a host failure,
carrying a normalized `SystemErrorTag`), `PlatformError.ts:36,109,157`.

**Construct one through the module's factories, never `new`.**
`new FileSystem.SystemError(...)` fails with "is not a constructor" — the
constructors are `PlatformError.systemError({...})` and
`PlatformError.badArgument({...})`.

Recover a nested `reason` without stripping the parent error
from the channel (e.g. an `AiError` whose `reason` is a `RateLimitError`):

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

## Yieldable — not everything is an Effect

Not every type is yieldable in v4, and the surface is narrower than the
vendored notes claim. **The notes are the trap here.**
`migration/yieldable.md` documents a `Yieldable` trait whose contract is
`asEffect(): Effect<A, E, R>`, lists `Option` and `Result` as implementors, and
states "the runtime calls `.asEffect()` internally when yielding". **None of
that holds at rc.109**: `asEffect` has zero occurrences in the entire core
source, in the vendored tree and in `node_modules` alike, and
`typeof Option.some(1).asEffect` is `undefined`. Rung 1 is prescriptive and it
has gone stale here; the source settles it.

Directly yieldable at rc.109 — **all five rows probed**, against two controls:
a positive `Effect.succeed` that yielded, and a discriminating `Option.some(7)`
that died, proving the harness could observe a failure to yield at all:

| Value | `yield*` inside `Effect.gen` |
| --- | --- |
| `Effect` | works |
| `Config` | works — it **is** an `Effect` (`Config<T> extends Effect<T, ConfigError>`, `Config.ts:108`) |
| any `Context.Service` | works |
| `Option` | **dies as a defect** |
| `Result` | **dies as a defect** |

**`Option` and `Result` are both off the list, and both die the same way.**
`yield* Option.some(7)` exits `Failure` with
`Die("Fiber.runLoop: Not a valid effect: some(7)")`; `Option.none()`,
`Result.succeed(42)` and `Result.fail("boom")` die identically (re-probed at
rc.109: `yield* Result.succeed(42)` dies
`"Fiber.runLoop: Not a valid effect: success(42)"`, against an
`Effect.succeed` control that returned normally). Note the **success**
cases die too: this is not "errors need a bridge", it is "these are not Effects
at all". Their `[Symbol.iterator]` yields the value itself, and the fiber loop
rejects anything carrying no `evaluate` (`internal/effect.ts:671`).

The bridge is a module function on `Effect`, one per type:

```ts
const u = yield* Effect.fromOption(maybeUser)              // Effect.ts:1816 — fails NoSuchElementError
const v = yield* Effect.fromResult(Fmt.parseResult(text))  // Effect.ts:1777 — fails typed with the Result's E
```

`Effect.fromOption` takes an optional second argument for the failure
(`Effect.fromOption(maybeUser, () => new UserMissing())`), so the
`NoSuchElementError` default is not something you have to live with.

To read a `Result` **outside** an Effect, narrow with `Result.isSuccess` /
`Result.isFailure`, then read the value off **`.success` / `.failure`** — not
`.value`:

```ts
const r = Fmt.parseResult(text)
if (Result.isSuccess(r)) use(r.success)   // NOT r.value — undefined, silently
else report(r.failure)                    // NOT r.left / r.right — there is no Either
```

The `Success` variant carries `.success` and the `Failure` variant `.failure`
(`Result.ts:161,99`); there is no `.value`, and no `.right` / `.left`. A read through `.value` compiles against `unknown` in
a loose context and returns `undefined` at runtime with no error — the exact
silent miss that cost a round-4 consumer a debugging cycle.

No longer yieldable — call the module function:

```ts
const n = yield* Ref.get(ref)          // NOT yield* ref
const v = yield* Deferred.await(deferred) // NOT yield* deferred
const r = yield* Fiber.join(fiber)     // NOT yield* fiber  (Fiber is not an Effect)
```

To hand an `Option` or a `Result` to a data-first combinator, go through the
same bridge — or just stay in a generator:

```ts
Effect.map(Effect.fromOption(Option.some(42)), (n) => n + 1)
```

**`Config` needs no bridge — it already IS an `Effect`.** `Config<T>` extends
`Effect<T, ConfigError>` (`Config.ts:108`), so it pipes straight into the
combinators, and there is no `Effect.fromConfig` to reach for:

```ts
Config.string("PORT").pipe(Effect.catchTag("ConfigError", () => Effect.succeed("8080")))
```

That `Config` sits beside `Option` in every "yieldable" list ever written — and
yet needs the opposite treatment — is exactly what makes the pair a trap: the
one that looks like it needs converting does not, and the one that looks
interchangeable with it dies. Two more `Config` facts worth carrying, both
probed on beta.94 and re-verified at beta.107:

- **`ConfigError` is not on the `effect` root.** It is `Config.ConfigError`;
  importing it from `"effect"` yields `undefined`, and a `catchTag` against that
  silently never matches.
- **`Config.option` still carries a `ConfigError`.** It turns a *missing key*
  into `Option.none()`, but a **provider-source failure survives** — a present,
  unparseable value still fails. It is not `Effect<Option<A>, never>`, and a test
  that only exercises the absent-key path will "prove" that it is.

## Yieldable errors — schema-backed error classes

Define errors as `Schema.TaggedError`. Naming trap: beta.102–105 renamed
`Schema.TaggedErrorClass` back to `Schema.TaggedError` (same curried call
shape); code written against earlier v4 betas fails with "TaggedErrorClass is
not a function". The payoff at the call site: an instance is yieldable —
`yield* new MyError({...})` fails the effect — and it is `instanceof Error`.
Capture unknown throwables with a `Schema.Defect()` field — `Schema.Defect` is a
**callable** in beta.94, not a bare schema value. The bare `cause: Schema.Defect`
typechecks but throws at construction (`Cannot read properties of undefined
(reading 'encoding')`); you must call it:

```ts
class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  cause: Schema.Defect() // NOT Schema.Defect — the bare form throws when constructed
}) {}

Effect.try({
  try: () => JSON.parse(input),
  catch: (cause) => ParseError.make({ cause })
})
```

`cause: Schema.Defect()` is **only** for wrapping an *unknown throwable* you
caught. It is the wrong tool for a **synthetic domain error** you raise yourself
from structured data (e.g. a navigation mismatch carrying `expected`/`depth`, or a
validation failure with a known shape). There, the fix for a `reason: string`
that flattens discriminating data is to **promote that data to typed fields** and
keep `reason` as the human `message` — not to add a `Defect`. Rule of thumb:
`Defect` captures a *foreign* failure; typed fields describe a *known* one.

Failing through this typed channel — never letting a `throw` escape as an
unhandled defect — is the invariant `hardening-a-parser-port` enforces.

## Cause — a flat array of reasons

v4 replaces the recursive `Cause` tree with a flat wrapper over an array. There
are only three reason variants:

```ts
interface Cause<E> { readonly reasons: ReadonlyArray<Reason<E>> }
// Reason = Fail<E> | Die | Interrupt ; empty reasons array = the empty cause
```

Inspect it by iterating `cause.reasons` and switching on `reason._tag`, or with
the reason-level guards and cause-level predicates:

```ts
const failures = cause.reasons.filter(Cause.isFailReason)
if (Cause.hasInterrupts(cause)) { /* was interrupted */ }
```

- Reason guards: `Cause.isFailReason` / `isDieReason` / `isInterruptReason`.
- Cause predicates: `Cause.hasFails` / `hasDies` / `hasInterrupts`.
- Extraction returns `Result` or `Option`: `Cause.findError` (Result),
  `Cause.findErrorOption` (Option), `Cause.findDefect`.
- Merge causes with `Cause.combine` — the sequential/parallel distinction is
  gone (it concatenates reasons).

The idiom to internalize is *iterate `reasons`, switch on `_tag`*.

### Probing `catchCause` — the obvious experiment lies

`Effect.catchCause`'s handler **does not run** when a fiber suspended in
`Effect.never` is interrupted externally; it **does** run on an interrupt cause
flowing through the chain (`Effect.interrupt`). The natural probe for "does
`catchCause` swallow interrupts?" is the former and returns the wrong answer.
Probe with `Effect.interrupt.pipe(Effect.catchCause(h))` — the handler runs,
`Cause.hasInterrupts(c)` is `true`, and the effect **succeeds**. It swallows
interruption. That is almost never what you want.

## `Effect.cached` memoizes the `Exit` — failures *and interrupts*

`Effect.cached(self)` returns `Effect<Effect<A, E, R>>` whose inner effect
replays the **first `Exit`**, whatever it was. Not just the success. A failure is
cached. **An interrupt is cached.**

That last one is the trap, because interruption is not a property of the effect
at all — it is a property of whichever fiber happens to touch it first. An
`Effect.timeout`, an `Effect.race`, a cancelled request, or a sibling failing
under `Effect.all` will permanently poison the memo for every later caller. The
replayed cause is an *interrupt*, which sits outside the effect's declared `E`
channel and is not recoverable with `Effect.catch` — so a memoized value's
declared error type becomes **unsound**.

Failure caching is its own footgun: a caller reaching for the natural spelling,
`Effect.retry(useTheMemo(), policy)`, silently no-ops — each retry replays the
cached `Exit` without re-running the underlying effect. Library-side failure
caching *destroys* the caller's ability to own the retry policy.

**For success-only memoization**, invalidate on any non-success exit:

```ts
const [resolve, invalidate] = Effect.runSync(
  Effect.cachedInvalidateWithTTL(expensiveEffect, Duration.infinity),
)
const memo = Effect.onExit(resolve, (exit) =>
  Exit.isSuccess(exit) ? Effect.void : invalidate,
)
```

Success is computed once, across sequential and concurrent observers. A failure
or interrupt is retried on the next call, and callers bound their own retries by
wrapping the *inner* effect. Reach for bare `Effect.cached` only when you
genuinely want a terminal failure — and say so in the TSDoc, including the
interrupt behavior, because no consumer will guess it.

## The `Effect.timeout` family — three forms, and timing out interrupts

Verified against rc.109: exactly three exist — `timeoutFail` and `timeoutTo`
are both `undefined`.

| Form | On timeout | Signature shape |
| --- | --- | --- |
| `Effect.timeout(duration)` | fails with **`Cause.TimeoutError`** (added to `E`) | `Effect<A, E \| Cause.TimeoutError, R>` |
| `Effect.timeoutOption(duration)` | succeeds with `Option.none()` — no added error | `Effect<Option<A>, E, R>` |
| `Effect.timeoutOrElse({ duration, orElse })` | runs the fallback (the old `timeoutTo`/`timeoutFail` shape) | `Effect<A \| A2, E \| E2, R \| R2>` |

**When the timeout wins, the source effect is interrupted** — its finalizers
run, so scoped resources clean up: a timed-out subprocess spawn closes its
scope and kills the child, a timed-out acquire releases. A per-operation
ceiling is therefore `op.pipe(Effect.timeout("30 seconds"))` composed by the
*caller* — never a bespoke timeout parameter threaded through a service. The
one sanctioned exception is a **package-owned ceiling that is part of the
service's error contract**: `@effected/git`'s `runClassified` owns a fixed
30s ceiling internally and maps expiry to its own `GitCommandError`, so
`Cause.TimeoutError` never escapes its methods — the ceiling is absorbed
into the taxonomy, not exposed as a parameter.

## `Predicate` helpers — never hand-write `isString` / record guards

The official LLMS guidance, adopted as a house rule: **never** write your own
type-guard helpers — the `Predicate` module ships them. A hand-rolled guard is
both a duplication and a subtle-drift risk; retire any you find on contact.

Two names that read as real but are not: **`Predicate.isRecord` and `Predicate.isPlainObject` do
NOT exist on rc.109** (probed; the vendored `Predicate.ts` has neither). The
guards that DO ship: `isString`, `isNumber`, `isBoolean`, `isObject`,
`isReadonlyObject`, `isObjectOrArray`, `isObjectKeyword`, `hasProperty`,
`isTagged`, `isIterable`, `isNullish`/`isNotNullish`, `isTupleOf`, and
friends — for a record check, pick the object refinement whose semantics you
verified in the module, not a remembered name.

## Scope and resource management

Resource idioms are unchanged — tie cleanup to a scope:

```ts
const resource = Effect.acquireRelease(
  acquire,                      // Effect<A>
  (a) => release(a)             // runs when the scope closes
)

Effect.scoped(
  Effect.gen(function* () {
    const a = yield* resource
    yield* Effect.addFinalizer(() => Effect.log("cleanup"))
    return yield* use(a)
  })
)
```

`Effect.addFinalizer` registers ad-hoc cleanup on the current scope. To satisfy
an effect's `Scope` requirement without closing the scope, use **`Scope.provide`**
— both `Scope.provide(effect, scope)` and
`effect.pipe(Scope.provide(scope))` work.

## Forking and fibers

The fork verbs take an options object:

- `Effect.forkChild` — child of the current fiber; there is no bare `Effect.fork`.
- `Effect.forkDetach` — detached from the parent lifecycle; there is no `forkDaemon`.
- `Effect.forkScoped` — tied to the current `Scope`.
- `Effect.forkIn` — forked into a specific `Scope`.

All four accept `{ startImmediately?: boolean; uninterruptible?: boolean | "inherit" }`
(data-first and data-last). A `Fiber` is no longer an Effect, so await it
explicitly:

```ts
const fiber = yield* Effect.forkChild(work)
const result = yield* Fiber.join(fiber)   // or Fiber.await for the Exit
```

**Keep-alive is built in.** A fiber suspended on `Deferred.await` keeps the
process alive without `runMain` — the core runtime has a reference-counted
keep-alive timer. `runMain` (from the platform packages) is still the
recommendation for SIGINT/SIGTERM handling, exit codes, and unhandled-error
reporting, but it is no longer what keeps the event loop from draining.

## Fiber-local state — `Context.Reference`

`FiberRef` and `FiberRefs` are removed (zero occurrences in core at rc.109,
and `effect/FiberRef` does not resolve as a module).
**`Differ` is not** — it survives as a top-level module (`Differ.ts:27`,
`interface Differ<in out T, in out Patch>`) for patch-based value updates; it
simply no longer has a `FiberRef` to serve. Fiber-local state is now a
`Context.Reference` — a service with a default value. Read it by yielding it,
and scope a new value with `Effect.provideService` (there is no free-floating
`FiberRef.set` mutation and no `Effect.locally`):

```ts
const Verbose = Context.Reference<boolean>("Verbose", { defaultValue: () => false })

const program = Effect.gen(function* () {
  const verbose = yield* Verbose        // reads the current value
  if (verbose) yield* Effect.log("noisy")
})

// scope a value to a sub-effect (replaces Effect.locally / FiberRef.set):
program.pipe(Effect.provideService(Verbose, true))
```

Built-in fiber refs moved to the `References` module — read them the same way:
`yield* References.CurrentLogLevel`, `References.MinimumLogLevel`,
`References.TracerEnabled`, `References.CurrentLogAnnotations`, etc.

**There is no `References.CurrentConcurrency`** — the module's own header prose
says the references "cover concurrency, scheduling, logging, tracing"
(`References.ts:4`), but no concurrency reference is exported at rc.109, and
a `yield*` against the remembered name gets `undefined`. Concurrency is an
*option* in v4 (`{ concurrency }` on `Effect.all` and friends), not an ambient
reference. The twelve that do exist: `CurrentLogAnnotations`, `CurrentLogLevel`,
`CurrentLogSpans`, `CurrentStackFrame`, `MinimumLogLevel`, `TracerEnabled`,
`TracerSpanAnnotations`, `TracerSpanLinks`, `TracerTimingEnabled`,
`UnhandledLogLevel`, `CurrentLoggers`, `LogToStderr`.

**Overriding the config provider is ordinary service provision.** There is no
`Effect.withConfigProvider`; `ConfigProvider.ConfigProvider` is itself a
`Context.Reference` (`ConfigProvider.ts:341`), so swap it with
`Effect.provideService(effect, ConfigProvider.ConfigProvider, provider)`. Reach
for a combinator name instead and you get `undefined is not a function` at the
call site — which reads like a bad import, not a missing API.

## Runtime and entrypoints

There is no `Runtime<R>` type carrying services and flags — the ambient service
set is just `Context<R>`. The run functions live on `Effect`:

- Capture the ambient services with `Effect.context<R>()`, then run a program
  against them with `Effect.runForkWith(services)(program)`.
- With no requirements: `Effect.runFork(effect)`.
- Boundary choices: `Effect.runPromise` (hand off to a Promise host),
  `Effect.runFork` (background/long-running), `Effect.runSync` (sparingly).
- The `Runtime` module now holds only process-lifecycle utils
  (`Runtime.makeRunMain`, `Runtime.defaultTeardown`).

For an application with multiple entrypoints sharing one layer graph, build a
`ManagedRuntime` once and reuse it:

```ts
const runtime = ManagedRuntime.make(AppLayer)
await runtime.runPromise(program)
// runtime.runFork(...) / await runtime.dispose() on shutdown
```

## Structural equality — deep by default

`Equal.equals` is **structural by default** in v4 — no `structuralRegion`
opt-in. Plain objects, arrays, `Map`, `Set`, `Date`, and `RegExp` compare by
value:

```ts
Equal.equals({ a: 1 }, { a: 1 })   // true
Equal.equals(NaN, NaN)             // true  (NaN equals itself)
```

To force identity comparison, opt out per object: `Equal.byReference(obj)`
(non-mutating Proxy) or `Equal.byReferenceUnsafe(obj)` (marks the object itself,
faster, permanent). Derive an `Equivalence` with `Equal.asEquivalence()`.

## Some names that look like values are calls

A nasty family: the name **does** exist and is spelled exactly like the value you
want, but it is a **factory with an optional (or no) argument** — so the uncalled
reference is a perfectly good expression and the mistake surfaces far away, as a
construction throw or a service that was never provided. Verified at rc.109:

| Write | Not | Source |
| --- | --- | --- |
| `Schema.Defect()` | `Schema.Defect` | `Schema.ts:10769` — `function Defect(options?: ErrorOptions)`. The canonical case: `cause: Schema.Defect` on an error class throws at construction. |
| `Schema.ErrorInstance()` | `Schema.ErrorInstance` | `Schema.ts:10669` — same shape, same optional-`options` trap, one page away in the same module. |
| `TestClock.layer()` | `TestClock.layer` | `testing/TestClock.ts:436` — a *function* returning a Layer, unlike almost every other `layer` in core. |
| `Schema.Literals(["a","b"])` | `Schema.Literals` | `Schema.ts:4956` — takes ONE array argument. |

**The discriminator is the optional argument.** `Schema.Cause(e, d)`
(`Schema.ts:10493`) and `Schema.Exit(...)` (`:10831`) are factories too, but their
arguments are required, so forgetting to call them is an immediate type error.
Only the zero-or-optional-arg factories type-check uncalled.

**And do not over-correct: `layer` is usually a value.** `TestConsole.layer` is a
plain `Layer.Layer<TestConsole>` (`testing/TestConsole.ts:294`), so
`TestConsole.layer()` is an error. The pair sits in the same directory and reads
identically. Check the declaration; do not pattern-match on the name.

## Verify, don't remember

One runtime probe beats an hour of type-error archaeology. From any package on
the v4 catalog:

```bash
node --input-type=module -e "
import * as Effect from 'effect/Effect'
console.log(typeof Effect.TheApiYouWant)
"
```

If it prints `undefined`, the name moved — check `node_modules/effect/dist/` for
the `.d.ts`, or climb the `effect-v4-source-lookup` ladder, before writing.
