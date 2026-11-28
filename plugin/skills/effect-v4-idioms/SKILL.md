---
name: effect-v4-idioms
description: >-
  Use when writing core Effect v4 code — generators (Effect.gen/Effect.fn), typed error handling and recovery
  (catch/catchTag/catchFilter/catchReason), yieldable errors, PlatformError on FileSystem/Path IO, Cause
  inspection, Scope and resource cleanup, forking and fibers, runtime/entrypoints, FiberRef-as-Context.Reference,
  structural equality, Config.schema inputs (a JSON-string input is Config.schema(Schema.fromJsonString(S)), and
  what withDefault does and does not swallow), and retrying or polling with Effect.retry/Effect.repeat options
  instead of a recursive Effect.sleep. Teaches the idiomatic v4 spelling.
when_to_use: >-
  retry with backoff, poll until done, Effect.sleep loop, acquireRelease, finalizer, fork, Fiber, environment
  variable, Config, Result, Cause, Effect.runPromise
---

# Effect v4 core idioms

The idiomatic way to write core v4 code — generators, errors, resources, fibers,
runtime, equality. This skill owns patterns, not the map.

**Look it up first.** Before you write a retry loop, a poll, a cache, a
resource wrapper, a parser or a path walk, find what core ships in
[effect-v4-module-index](../effect-v4-module-index/SKILL.md)'s *Routing by
task* table, then grep the kit:
`grep -ri "<intent words>" "{{skill_dir effected-packages}}/references/constructs/"`.
Confirm a name exists with
[effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md) before you rely
on it. Every identifier below was verified to exist, and
every `file:line` citation checked against the vendored tree; when you reach
past this list, run one runtime probe
(`node --input-type=module -e "import * as Effect from 'effect/Effect'; console.log(typeof Effect.X)"`)
before writing — v4 is a ground-up redesign and muscle memory lies. An
`undefined` means the name moved: read the `.d.ts` in `node_modules/effect/dist/`.

## Generators — `Effect.gen` for workflows, `Effect.fn` for operations

Reach for `Effect.gen(function*() { ... })` when a block *orchestrates*:
several `yield*`, branching, reading services, implementing a layer or handler.
A generator that needs `this` passes it in an options object —
`Effect.gen({ self: this }, function* () { … })`, never `Effect.gen(this, fn)`.

A parameterized operation you call from several places is `Effect.fn`, not an
inline `Effect.gen`:

- `Effect.fn("name")(function* (id: string) { … })` — named span **and** clean
  stack frames; use at public/business operation boundaries.
- `Effect.fn(…)` — bare: the stack frames without a named span, for inside a
  module where the span would be noise.
- `Effect.fnUntraced(…)` — escape hatch only, never a default.
- **`Effect.fn` is not generator-only.** `Effect.fn("double")((n: number) => Effect.succeed(n * 2))`
  works when there is nothing to `yield*`. The body is **lazy** (it runs when
  the effect executes, not when `double(21)` is called), and **a `throw` from it
  is a `Die` defect**, so a body that can throw belongs in `Effect.try`.

## Wrapping a callback API — `Effect.callback`

There is no `Effect.async`; it is `undefined`, and the "not a function" points
nowhere near the cause. Use **`Effect.callback`**. **Resuming runs the fiber
synchronously, on the caller's stack** (`callbackOptions` in
`internal/effect.ts`): everything after the `yield*` runs inside whatever called
`resume` — React's commit phase, an emitter's dispatch loop — before that call
returns. When the caller must finish first, defer it:
`queueMicrotask(() => resume(Effect.void))`.

## Error handling — `catch*` recovery

- **`Effect.catchTag(tag, handler)` / `Effect.catchTags({ Tag: handler })`** —
  the default for domain errors. `catchTag` also takes a non-empty tag array
  sharing one handler (`Effect.ts:2911` `Arr.NonEmptyReadonlyArray<Tags<E>>`).
  The tag must be a member of `E` (`K extends Tags<E>`; `catchTags` maps an
  unknown key to `never`, `Effect.ts:3020-3021`), so **removing an error from
  a public signature breaks every caller that handled it**, even when it could
  never fire: version it as a breaking change and tell callers to delete the
  dead handler ([release-and-publish](../release-and-publish/SKILL.md)).
- **`Effect.catch`** for any typed failure (no `catchAll`), **`catchCause`** for
  the full cause, **`catchDefect`** for defects, **`Effect.match`** to totalize.
- Selective recovery takes a `Filter`, not an `Option`-returning predicate:
  `Effect.catchFilter(Filter.fromPredicate((e: number) => e === 42), () => Effect.succeed("caught"))`;
  `Effect.catchCauseFilter` is the cause-level form.
- **`Effect.catchReason(tag, reasonTag, handler)`** recovers a nested `reason`
  (an `AiError`'s `RateLimitError`) and keeps the parent error.

**`Effect.catch` recovers typed failures ONLY — defects and interrupts pass
straight through.** A bare `JSON.parse` in a function whose channel is `never`
is a defect no catch further out absorbs; wrap it in `Effect.try` where it
throws. Before you write recovery around a finalizer, an interrupt or a throwing
call, load [errors-and-causes.md](./references/errors-and-causes.md): a typed
failure that meets a defect is **demoted to a `Die`**, so your `catchTag`
silently stops running.

## `PlatformError` — the error type of core IO

Core `FileSystem` / `Path` operations fail with `PlatformError`. The module is
re-exported **as a namespace** and the class
(PlatformError.ts:163, a `Data.TaggedError("PlatformError")`) lives inside it,
so the type is the doubled `PlatformError.PlatformError`, from
`import type { PlatformError } from "effect"`. Never type the channel `unknown`
because the name looks like a typo.

- **`fs.exists` maps `NotFound` to `false` and re-fails every other reason.**
  `Effect.orElseSucceed(() => false)` on it is a policy (an unreadable path
  reported absent), not a fix.
- **Construct one with `PlatformError.systemError` / `badArgument`** —
  `new FileSystem.SystemError(...)` is "not a constructor".
- Before you branch on an IO failure or write an existence check, load
  [platform-error.md](./references/platform-error.md) for the `reason` shape.

## Yieldable — not everything is an Effect

| Value | `yield*` inside `Effect.gen` |
| --- | --- |
| `Effect`, `Config`, any `Context.Service` | works |
| `Option`, `Result` | **dies as a defect** — `Not a valid effect`, success cases included |
| `Ref`, `Deferred`, `Fiber` | not yieldable — `Ref.get(ref)`, `Deferred.await(d)`, `Fiber.join(f)` |

- **Bridge with `Effect.fromOption(opt, () => new Missing())` and
  `Effect.fromResult(result)`.** Effect's own migration note still calls
  `Option` and `Result` yieldable; it is wrong.
- **Read a `Result` off `.success` / `.failure`, never `.value`** — `.value` is
  silently `undefined`, and there is no `.left` / `.right`.
- **`Config` already IS an `Effect`** — pipe it into `Effect.catchTag`; there is
  no `Effect.fromConfig`.

Before you yield anything that is not an Effect or a service, load
[yieldable-and-bridges.md](./references/yieldable-and-bridges.md): a wrong guess
dies at run time.

## Config inputs

- **`ConfigError` is `Config.ConfigError`**, not on the `effect` root; a
  `catchTag` against the root import never matches.
- **`Config.option` still carries a `ConfigError`** — only a missing key becomes
  `Option.none()`.
- **A JSON-string input is `Config.schema(Schema.fromJsonString(S), "NAME")`**,
  never `Config.String` + `JSON.parse` + a decode.
- **`withDefault` covers absent data only**; a malformed value is a typed
  `ConfigError` it does not swallow, and `fromEnv` reads `""` as absent unless
  `{ preserveEmptyStrings: true }`.
- **Swap the provider with `Effect.provideService(effect, ConfigProvider.ConfigProvider, provider)`**;
  there is no `Effect.withConfigProvider`.

Before you read a structured, JSON or GitHub Actions input, or decide what an
empty variable means, load [config-inputs.md](./references/config-inputs.md):
it holds the probed `withDefault` table.

## Yieldable errors — schema-backed error classes

Define errors as `Schema.TaggedError` (`Schema.TaggedErrorClass` is `undefined`).
`yield* new MyError({...})` fails the effect, and the instance is
`instanceof Error`. Capture an unknown throwable with a **called**
`Schema.Defect()`; the bare `cause: Schema.Defect` typechecks and throws at
construction:

```ts
class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  cause: Schema.Defect() // NOT Schema.Defect — the bare form throws when constructed
}) {}

Effect.try({ try: () => JSON.parse(input), catch: (cause) => ParseError.make({ cause }) })
```

`Defect` captures a *foreign* failure; give a *known* one typed fields instead
of a flattened `reason: string`.

**Core's `EncodingError` keeps the whole decoder input on the error**, and it
rides into `JSON.stringify`, `Cause.pretty` and every payload. Before you
decode a token, a key or an encrypted envelope with `Base64`, `Base64Url` or
`Hex`, load [errors-and-causes.md](./references/errors-and-causes.md) and map
the error to a message-only one, or the secret lands in your logs.

## Cause — a flat array of reasons

A `Cause` is a flat `reasons` array of `Fail<E> | Die | Interrupt`. **Iterate
`cause.reasons` and switch on `reason._tag`**, or use the guards
(`cause.reasons.filter(Cause.isFailReason)`, `Cause.hasInterrupts(cause)`).
`Cause.findError` returns a `Result`, `Cause.findErrorOption` an `Option`, and
`Cause.combine` concatenates reasons.

## Memoizing, timeouts and polling

- **`Effect.cached` memoizes the first `Exit`, failures included**, so a retry
  around the memo replays the failure. Before you cache anything a caller may
  retry, load [memoizing-with-cached.md](./references/memoizing-with-cached.md)
  for the success-only recipe.
- **The timeout forms are `Effect.timeout`, `timeoutOption` and
  `timeoutOrElse`** (`timeoutFail` and `timeoutTo` are `undefined`). A timeout
  **interrupts** the source; the caller composes the ceiling, never a timeout
  parameter on a service.
- **Never wire an `AbortSignal` into core `HttpClient`** — it already aborts on
  interruption. Before you add a timeout or cancellation, load
  [timeouts-and-interruption.md](./references/timeouts-and-interruption.md).

Poll with `Effect.repeat` options, never a recursive `Effect.sleep`:

```ts
const status = yield* Effect.repeat(pollOnce, {
  schedule: Schedule.spaced("2 seconds"),
  until: (s): s is "done" => s === "done",   // a refinement NARROWS the result type
  times: 30,
})
```

**`times: 2` is three runs, `until` with no `schedule` is a busy loop, and
`Effect.retry` retries only a plain typed failure.** Before you write a poll or
a retry policy, load [polling-and-retry.md](./references/polling-and-retry.md).

## `Predicate` helpers — never hand-write a type guard

The `Predicate` module ships them; retire a hand-rolled guard on contact.
**`Predicate.isRecord` and `Predicate.isPlainObject` do NOT exist.** The guards
that do: `isString`, `isNumber`, `isBoolean`, `isObject`, `isReadonlyObject`,
`isObjectOrArray`, `isObjectKeyword`, `hasProperty`, `isTagged`, `isIterable`,
`isNullish`/`isNotNullish`, `isTupleOf` and friends — pick the object
refinement whose semantics you verified in the module.

## Scope, resources and fibers

Tie cleanup to a scope with `Effect.acquireRelease(acquire, release)` inside
`Effect.scoped`, plus `Effect.addFinalizer` for ad-hoc cleanup; satisfy a
`Scope` requirement without closing it with **`Scope.provide(effect, scope)`**.

The fork verbs: `Effect.forkChild` (there is no bare `fork`), `Effect.forkDetach`
(no `forkDaemon`), `Effect.forkScoped`, `Effect.forkIn`; all take
`{ startImmediately?, uninterruptible? }`, data-first or data-last. A `Fiber` is not an Effect:
`yield* Fiber.join(fiber)`, or `Fiber.await` for the `Exit`.

- **Clearing a scope's reference and closing it must be one uninterruptible
  step**, or an interrupt between them leaks the scope.
- **`FileSystem.makeTempDirectoryScoped` releases with `Effect.orDie`**, so a
  directory your work removed makes the close die.
- **A child forked by a helper outlives the helper** — `forkChild` attaches to
  the caller's fiber.

Before you hold a scope in a `Ref`, use a scoped temp directory your code may
delete, or fork from a helper, load
[scopes-and-fibers.md](./references/scopes-and-fibers.md): each leaks or dies
far from the line that caused it.

## Fiber-local state — `Context.Reference`

`FiberRef` is removed; fiber-local state is a `Context.Reference`, read by
yielding it and scoped with `Effect.provideService` (no `FiberRef.set`, no
`Effect.locally`):

```ts
const Verbose = Context.Reference<boolean>("Verbose", { defaultValue: () => false })
const program = Effect.gen(function* () { if (yield* Verbose) yield* Effect.log("noisy") })
program.pipe(Effect.provideService(Verbose, true))
```

Built-in refs live in `References`. **There is no
`References.CurrentConcurrency`** — concurrency is the `{ concurrency }` option.
Before you read a built-in reference by a remembered name, load
[fiber-local-state.md](./references/fiber-local-state.md) for the twelve that
exist.

## Runtime and entrypoints

There is no `Runtime<R>`; the ambient service set is `Context<R>`. Run at the
boundary with `Effect.runPromise`, `Effect.runFork` or (sparingly)
`Effect.runSync`; several entrypoints share one `ManagedRuntime.make(AppLayer)`.
**Import `@effect/platform-node` and `@effect/platform-bun` by subpath**
(`@effect/platform-node/NodeRuntime`): the root needs the `redis` peer. Before
you write a `main`, load
[runtime-and-entrypoints.md](./references/runtime-and-entrypoints.md).

## Structural equality — deep by default

`Equal.equals` compares plain objects, arrays, `Map`, `Set`, `Date`, `RegExp`
and buffers by value; `NaN` equals itself. **`Ref` and `MutableRef` compare
by their current contents**, so never use a ref as a set member, map key or memo
key: key on a stable id, or wrap it in `Equal.byReference(obj)`, a
non-mutating Proxy (`Equal.byReferenceUnsafe` marks the object permanently). Derive an
`Equivalence` with `Equal.asEquivalence()`.

## Some names that look like values are calls

The name exists, but it is a **factory with an optional (or no) argument**, so
the uncalled reference type-checks and the mistake surfaces far away:

| Write | Not | Source |
| --- | --- | --- |
| `Schema.Defect()` | `Schema.Defect` | `Schema.ts:9367` — `function Defect(options?: ErrorOptions)`. The canonical case: `cause: Schema.Defect` on an error class throws at construction. |
| `Schema.ErrorInstance()` | `Schema.ErrorInstance` | `Schema.ts:9295` — same shape, same optional-`options` trap, one page away in the same module. |
| `TestClock.layer()` | `TestClock.layer` | `testing/TestClock.ts:571` — a *function* returning a Layer, unlike almost every other `layer` in core. |
| `Schema.Literals(["a","b"])` | `Schema.Literals` | `Schema.ts:5092` — takes ONE array argument. |

`Schema.Cause(e, d)` (`Schema.ts:11354`) and `Schema.Exit(...)` (`:15467`) are
factories too, but their arguments are required, so forgetting to call them is
an immediate type error. **And do not over-correct:** `TestConsole.layer` is a
plain `Layer.Layer<TestConsole>` (`testing/TestConsole.ts:330`), so
`TestConsole.layer()` is an error. Check the declaration, not the name.

## Additional resources

- [errors-and-causes.md](./references/errors-and-causes.md) — `Effect.catch` and a `never` channel, `catchReason`/`catchReasons`/`catchEager`, `Defect` versus typed fields, `EncodingError`'s leaked input, the `Cause` guards, a typed failure demoted to `Die`, and the `catchCause` probe that lies. Load when: recovery "doesn't run", a finalizer or a sibling fiber can die, you decode a secret, or you sort a cause by reason kind.
- [platform-error.md](./references/platform-error.md) — the doubled type name, the `reason` shape, what `fs.exists` absorbs, and the factories. Load when: typing or branching on a `FileSystem`/`Path` failure, or writing an existence check.
- [yieldable-and-bridges.md](./references/yieldable-and-bridges.md) — the probed yieldable table, why the migration note is wrong, `fromOption`/`fromResult`, reading a `Result`, and `Config` as an Effect. Load when: yielding an `Option`, `Result`, `Ref`, `Deferred` or `Fiber`, or a `Not a valid effect` defect appears.
- [config-inputs.md](./references/config-inputs.md) — `Config.ConfigError`, `Config.option`, `Config.schema` with `fromJsonString`, the `withDefault` table, `preserveEmptyStrings`, and swapping the provider. Load when: reading a structured, JSON or GitHub Actions input, or deciding what an empty variable means.
- [memoizing-with-cached.md](./references/memoizing-with-cached.md) — what `Effect.cached` stores, why interrupts are never cached, and success-only memoization. Load when: memoizing an effect a caller might retry.
- [timeouts-and-interruption.md](./references/timeouts-and-interruption.md) — the three timeout forms, the package-owned-ceiling exception, and `HttpClient`/`tryPromise` cancellation. Load when: adding a timeout, a cancellation or an `AbortSignal`.
- [polling-and-retry.md](./references/polling-and-retry.md) — the `Effect.repeat`/`Effect.retry` options object and its three traps. Load when: writing a poll, a backoff, or anything with `Effect.sleep` in a loop.
- [scopes-and-fibers.md](./references/scopes-and-fibers.md) — the clear-and-close race, `makeTempDirectoryScoped`'s dying release, a helper's forked child, and keep-alive. Load when: a scope lives in a `Ref`, a temp directory may be removed early, or a helper forks a fiber.
- [fiber-local-state.md](./references/fiber-local-state.md) — `Differ`'s survival, the twelve `References`, and no `CurrentConcurrency`. Load when: reading or overriding a built-in fiber reference.
- [runtime-and-entrypoints.md](./references/runtime-and-entrypoints.md) — the run functions, `Effect.runForkWith`, the subpath-import rule and `ManagedRuntime`. Load when: writing a `main`, a Promise-host boundary, or several entrypoints over one layer graph.
