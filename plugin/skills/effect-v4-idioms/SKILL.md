---
name: effect-v4-idioms
description: Use when writing core Effect v4 code — generators (Effect.gen/Effect.fn), typed error handling and recovery (catch/catchTag/catchFilter/catchReason), yieldable errors, PlatformError on FileSystem/Path IO, Cause inspection, Scope and resource cleanup, forking and fibers, runtime/entrypoints, FiberRef-as-Context.Reference, and structural equality. Teaches the idiomatic v4 spelling; for pure v3→v4 renames consult effect-v4-construct-map. Verified against effect@4.0.0-beta.94+.
---

# Effect v4 core idioms

The idiomatic way to write core v4 code — generators, errors, resources, fibers,
runtime, equality. For *which module* to reach for in the first place (what is
`Sink`, `RcMap`, `Latch`…), consult `effect-v4-module-index` — this skill owns
patterns, not the map. This is the *how to write it well* companion to
`effect-v4-construct-map` (which owns the flat v3→v4 rename tables and the
`Context.Service` / `Schema.TaggedErrorClass` migration rows — cross-reference it
rather than duplicate). Every identifier below was probed against
`effect@4.0.0-beta.94+`; when you reach past this list, run one runtime probe
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

## `Effect.async` is `Effect.callback`

Wrapping a callback API is **`Effect.callback`**. `Effect.async` is `undefined`
in v4 — the rename is not guessable from the v3 name, and reaching for the v3
spelling fails at the call site with a "not a function" that points nowhere near
the cause. See `effect-v4-construct-map`.

## Error handling — `catch*` recovery

The recovery family lost its `All` and gained `Filter`/`Reason` variants. The
idiomatic recoveries:

- **`Effect.catchTag(tag, handler)` / `Effect.catchTags({ Tag: handler })`** —
  targeted typed recovery, both unchanged. Default choice for domain errors.
  `catchTag` also accepts a non-empty tag ARRAY sharing one handler —
  `Effect.catchTag(["UnknownRefError", "GitCommandError"], () => fallback)` —
  which obviates `catchTags` boilerplate when several tags route to the same
  recovery (verified at beta.98, `Effect.ts` `NonEmptyReadonlyArray<Tags<E>>`).
- **`Effect.catch(handler)`** — recover from any typed failure (the v3
  `catchAll`). **`Effect.catchCause(handler)`** for full-cause infra handling,
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
(`export * as PlatformError from "./PlatformError.ts"`, index.ts:397) and the
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
Effect.Effect<boolean, PlatformError>` (FileSystem.ts:134) — verified against
beta.94.

**New in v4** — recover a nested `reason` without stripping the parent error
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

## Yieldable trait — not everything is an Effect

v4 narrows the old "many types ARE Effects" model to a **`Yieldable`** trait:
`yield*`-able in a generator, but not assignable to `Effect`.

Still yield directly (no call needed): `Effect`, `Option` (fails
`NoSuchElementError`), `Result` (fails with its error), `Config` (fails
`ConfigError`), and any `Context.Service`.

No longer yieldable — call the module function:

```ts
const n = yield* Ref.get(ref)          // NOT yield* ref
const v = yield* Deferred.await(deferred) // NOT yield* deferred
const r = yield* Fiber.join(fiber)     // NOT yield* fiber  (Fiber is not an Effect)
```

To hand a Yieldable to a data-first combinator, materialize it with
`.asEffect()` — or just stay in a generator:

```ts
Effect.map(Option.some(42).asEffect(), (n) => n + 1)
```

**`Config` is the exception — it already IS an `Effect`, and has no
`.asEffect()`.** `Config<T>` is an `Effect<T, ConfigError>`, so it pipes straight
into the combinators:

```ts
Config.string("PORT").pipe(Effect.catchTag("ConfigError", () => Effect.succeed("8080")))
```

`Config.string("PORT").asEffect()` **throws** (`typeof` is `undefined`) *and*
fails tsgo. The `.asEffect()` habit generalizes from `Option`, and `Config` sits
in the same "yieldable" list above — which is exactly what makes it a trap. Two
more `Config` facts worth carrying, both probed on beta.94:

- **`ConfigError` is not on the `effect` root.** It is `Config.ConfigError`;
  importing it from `"effect"` yields `undefined`, and a `catchTag` against that
  silently never matches.
- **`Config.option` still carries a `ConfigError`.** It turns a *missing key*
  into `Option.none()`, but a **provider-source failure survives** — a present,
  unparseable value still fails. It is not `Effect<Option<A>, never>`, and a test
  that only exercises the absent-key path will "prove" that it is.

## Yieldable errors — schema-backed error classes

Define errors as `Schema.TaggedErrorClass` (see `effect-v4-construct-map` for
the full migration row). The payoff at the call site: an instance is yieldable —
`yield* new MyError({...})` fails the effect — and it is `instanceof Error`.
Capture unknown throwables with a `Schema.Defect()` field — `Schema.Defect` is a
**callable** in beta.94, not a bare schema value. The bare `cause: Schema.Defect`
typechecks but throws at construction (`Cannot read properties of undefined
(reading 'encoding')`); you must call it:

```ts
class ParseError extends Schema.TaggedErrorClass<ParseError>()("ParseError", {
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

The full guard/extractor rename table lives in `effect-v4-construct-map`; the
idiom to internalize is *iterate `reasons`, switch on `_tag`*.

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

Verified against beta.97: exactly three exist — `timeoutFail` and `timeoutTo`
do **not**.

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
both a duplication and a subtle-drift risk (v3 ports carry several; retire
them on contact).

Beware the v3 names: **`Predicate.isRecord` and `Predicate.isPlainObject` do
NOT exist on beta.98** (probed; the vendored `Predicate.ts` has neither). The
guards that DO ship: `isString`, `isNumber`, `isBoolean`, `isObject`,
`isReadonlyObject`, `isObjectOrArray`, `isObjectKeyword`, `hasProperty`,
`isTagged`, `isIterable`, `isNullish`/`isNotNullish`, `isTupleOf`, and
friends — for a record check, pick the object refinement whose semantics you
verified in the module, not a remembered v3 name.

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
(the renamed `Scope.extend`) — both `Scope.provide(effect, scope)` and
`effect.pipe(Scope.provide(scope))` work.

## Forking and fibers

The fork verbs are renamed and now take an options object:

- `Effect.forkChild` — child of the current fiber (the old `Effect.fork`).
- `Effect.forkDetach` — detached from the parent lifecycle (old `forkDaemon`).
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

## FiberRef is gone — use `Context.Reference`

`FiberRef` (and `FiberRefs`, `Differ`) is removed. Fiber-local state is now a
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
`yield* References.CurrentLogLevel`, `References.CurrentConcurrency`,
`References.MinimumLogLevel`, etc.

## Runtime and entrypoints

The `Runtime<R>` type (v3's bundle of `Context` + flags + `FiberRefs`) is gone —
use `Context<R>`. The run functions live on `Effect`:

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
Equal.equals(NaN, NaN)             // true  (was false in v3)
```

To force identity comparison, opt out per object: `Equal.byReference(obj)`
(non-mutating Proxy) or `Equal.byReferenceUnsafe(obj)` (marks the object itself,
faster, permanent). Derive an `Equivalence` with `Equal.asEquivalence()` (the
renamed `equivalence()`).

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
the `.d.ts`, or the `effect-v4-construct-map` rename tables, before writing.
