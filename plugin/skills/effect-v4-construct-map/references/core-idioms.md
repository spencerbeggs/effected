# Core idioms — v3 → v4

Verified against `effect@4.0.0-beta.94+`. Idiomatic form → see `effect-v4-idioms`.

## Constructor and validation semantics

This bites *pervasively* in v3→v4 ports.

- **`new X({...})` VALIDATES structurally in v4** (v3's did not). Passing an
  explicit `undefined` for a `Schema.optionalKey` field throws
  `Expected string, got undefined` — a *present* key whose value is
  `undefined` is not the same as an *absent* key. `{ disableChecks: true }`
  does NOT rescue you; it skips `.check(...)` refinements only, not the
  structural parse. `X.make` behaves identically. In engine/hot-path code
  that builds nodes from possibly-absent fields, use conditional spreads:
  `new Node({ offset, length, ...(anchor !== undefined ? { anchor } : {}) })`.
  v3 engines pass bare possibly-undefined fields everywhere (`makeScalar`,
  `compose*`), and each site is a latent runtime throw. Measured `new`
  validation overhead is ~8%, so `new` stays fine on hot paths for the
  ergonomics; just never pass explicit `undefined`.
- `X.make(input)` validates only what the field schemas constrain. Bare
  `Schema.Number` fields accept `-1.5`; attach `.check(...)` constraints or
  `make` is a rubber stamp.
- The **type side** of `make` for nested class fields wants class instances
  (`Comparator.make({ operator, version: SemVer.make(parts) })`); the runtime
  coerces plain records, but the types are stricter than the runtime — follow
  the types.

## Removed or fundamentally changed modules

| v3 | v4 |
| --- | --- |
| `Either` module / `Effect.either(fx)` | **Gone.** `Effect.result(fx)` → `Effect<Result<A, E>>`; branch with `Result.isSuccess` / `Result.isFailure` (from `effect/Result`) |
| `Runtime<R>` type | **Removed.** Use `Context<R>`. `Runtime` module now only holds `Teardown`, `defaultTeardown`, `makeRunMain` |
| `FiberRef` / `FiberRefs` / `FiberRefsPatch` / `Differ` | **Removed.** Fiber-local state is now `Context.Reference`; built-ins moved to the `References` module |
| `SortedSet` | **Removed entirely.** Use a sorted `ReadonlyArray` + `Order`, or `HashSet` when order is not needed |
| `Hash.cached(this)(h)` | **Removed.** Hash without caching; a cheap canonical form is `Hash.string(canonicalString)` |
| `effect/schema/Check` (guessed name) | Does not exist. Check combinators live on `Schema` itself as `Schema.is*` |
| `Option.fromNullable(x)` | **Gone.** `Option.fromUndefinedOr(x)` for `T \| undefined` |

## Async, callbacks and retry

| v3 | v4 |
| --- | --- |
| `Effect.async` | **`Effect.callback`** — `Effect.async` is `undefined`; the name is not guessable from the v3 one |
| `Schedule.compose` | **Gone** (`typeof` is `undefined`). Express the whole policy in one options object: `Effect.retry(fx, { schedule, times, while })` |

`Effect.retry(effect, { schedule: Schedule.exponential("100 millis"), times: 3, while: (e) => ... })`
typechecks on beta.94. Reaching for `Schedule.compose` to stack a recurrence
limit onto a backoff is the v3 habit; in v4 the limit is just another key.

## Error handling — `catchAll*` → `catch*`, `catchSome*` → `catch*Filter`

| v3 | v4 |
| --- | --- |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchAllDefect` | `Effect.catchDefect` (same shape, renamed) |
| `Effect.catchSome` (Option-returning fn) | `Effect.catchFilter` (takes a `Filter`, e.g. `Filter.fromPredicate`) |
| `Effect.catchSomeCause` | `Effect.catchCauseFilter` |
| `Effect.catchSomeDefect` | **Removed** |
| `Effect.catchTag` / `catchTags` / `catchIf` | unchanged — and `catchTag` now also takes a non-empty tag ARRAY sharing one handler (`Effect.catchTag(["A", "B"], recover)`), replacing a two-entry `catchTags` |
| — (new in v4) | `Effect.catchReason` / `catchReasons` / `catchEager` |

## Generators, yieldables, forking, runtime, scope, equality

| Topic | v3 | v4 |
| --- | --- | --- |
| gen + `this` | `Effect.gen(this, fn)` | `Effect.gen({ self: this }, fn)` |
| yield `Ref` | `yield* ref` | `yield* Ref.get(ref)` |
| yield `Deferred` | `yield* deferred` | `yield* Deferred.await(deferred)` |
| yield `Fiber` | `yield* fiber` | `yield* Fiber.join(fiber)` |
| Yieldable → combinator | direct | `.asEffect()` (e.g. `Option.some(42).asEffect()`) |
| fork | `Effect.fork` | `Effect.forkChild` |
| fork daemon | `Effect.forkDaemon` | `Effect.forkDetach` |
| fork all / err-handler | `Effect.forkAll` / `forkWithErrorHandler` | **Removed** |
| keep-alive | needs `runMain` | built into core runtime |
| FiberRef read | `FiberRef.get(fr)` | `yield* References.X` |
| FiberRef local | `Effect.locally` | `Effect.provideService(effect, Ref, value)` |
| FiberRef set | `FiberRef.set` | `Effect.provideService` |
| Scope extend | `Scope.extend` | `Scope.provide` |
| get runtime | `Effect.runtime<R>()` | `Effect.context<R>()` |
| run with runtime | `Runtime.runFork(rt)(program)` | `Effect.runForkWith(services)(program)` |
| Equal default | reference (needs `structuralRegion`) | **structural by default** |
| Equal opt-out | — | `Equal.byReference(obj)` / `Equal.byReferenceUnsafe(obj)` |
| Equal NaN | `Equal.equals(NaN, NaN)` → `false` | → `true` |
| Equal equivalence | `Equal.equivalence()` | `Equal.asEquivalence()` |

### `Effect.fn` is not generator-only

`Effect.fn("name")((n: number) => Effect.succeed(n * 2))` — a **non-generator
that returns an Effect** — both runs and typechecks on beta.94. The generator
form is the common case, not the requirement. Reach for the plain arrow when the
body has nothing to `yield*`; you still get the named span and stack frames.

## Cause and Exit

| Topic | v3 | v4 |
| --- | --- | --- |
| Cause shape | recursive tree (`Sequential`/`Parallel`/…) | flat `{ reasons: Reason[] }`, `Reason = Fail \| Die \| Interrupt` |
| Cause empty | `Cause.isEmptyType(c)` | `c.reasons.length === 0` |
| Exit → cause | `Exit.causeOption(exit)` | **Gone.** `Exit.getCause(exit)` → `Option<Cause<E>>` |
| Fail vs Die | inspect the tree | `Cause.hasFails(c)` / `hasDies(c)` / `hasInterrupts(c)` |
| Cause type guards | `isFailType` / `isDieType` / `isInterruptType` | `isFailReason` / `isDieReason` / `isInterruptReason` |
| Cause presence | `isFailure` / `isDie` / `isInterrupted` / `isInterruptedOnly` | `hasFails` / `hasDies` / `hasInterrupts` / `hasInterruptsOnly` |
| Cause seq/par | `Cause.sequential` / `parallel` | `Cause.combine` (seq/par distinction gone) |
| Cause find | `failureOption` / `failureOrCause` / `dieOption` / `interruptOption` | `findErrorOption` / `findError` (→ `Result`) / `findDefect` / `findInterrupt`; also `findFail` → `Result<Fail<E>>` — the wrapper form, read the error as `.success.error` |
| Cause collect | `Cause.failures(c)` / `defects(c)` | `c.reasons.filter(Cause.isFailReason)` / `isDieReason` |
| `*Exception` classes | `NoSuchElementException`, `TimeoutException`, … | `NoSuchElementError`, `TimeoutError`, … (+ `isXError` guards); `RuntimeException` / `InterruptedException` removed |

To assert *malformed input fails typed rather than defecting* — the invariant
`hardening-a-parser-port` demands — pair them:

~~~ts
const exit = yield* Effect.exit(codec.parse(bad))
const cause = Exit.getCause(exit)          // Option<Cause<E>>
if (Option.isSome(cause)) {
  assert.isTrue(Cause.hasFails(cause.value))
  assert.isFalse(Cause.hasDies(cause.value))
}
~~~

Built-in FiberRefs moved to the `References` module: `currentConcurrency` →
`References.CurrentConcurrency`, `currentLogLevel` → `References.CurrentLogLevel`,
`currentMinimumLogLevel` → `References.MinimumLogLevel`, `currentLogAnnotations` →
`References.CurrentLogAnnotations`, `currentScheduler` → `References.Scheduler`,
`currentMaxOpsBeforeYield` → `References.MaxOpsBeforeYield`,
`currentTracerEnabled` → `References.TracerEnabled`.

Yieldable trait: v3 many types WERE Effect subtypes; v4 has a narrower
`Yieldable` trait — `yield*`-able but not assignable to `Effect`. Still directly
yieldable: `Effect`, `Option` (fails `NoSuchElementError`), `Result`, `Config`
(fails `ConfigError`), `Context.Service`. No longer yieldable (call the module
fn): `Ref` / `Deferred` / `Fiber` as above.

## Config

### The accessors are lowercase — and the capitalized names are Schemas

`Schema.String` teaches you that capitalized is the v4 name. **That
generalization is wrong for `Config`.**

| you want | v4 |
| --- | --- |
| `Config.String("port")` | `Config.string("port")` — `Config.String` is `undefined` |
| `Config.Number(...)` | `Config.number(...)` |
| — | `Config.Boolean` / `Config.Port` / `Config.LogLevel` **exist but are Schemas, not Configs** |

### `Config<T>` IS an `Effect<T, ConfigError>` — there is no `.asEffect()`

Probed on beta.94: `Config.string("K")` is directly assignable to
`Effect<string, Config.ConfigError>`, and pipes straight into recovery:

~~~ts
Config.string("K").pipe(Effect.catchTag("ConfigError", () => Effect.succeed("default")))
~~~

`Config.string("K").asEffect()` is **not** a function (`typeof` is `undefined`)
and does not typecheck. The `.asEffect()` habit comes from the narrower v4
`Yieldable` trait, which *does* require it for `Option` and friends — but
`Config` is already an Effect, so reaching for it here throws AND fails tsgo.

**`ConfigError` is not exported from the `effect` root.** It is
`Config.ConfigError` (`typeof` on the root export is `undefined`). Importing
`{ ConfigError } from "effect"` gets you `undefined`, and a `catchTag`
against it silently never matches.

### `Config.option` still carries a `ConfigError`

It is **not** `Effect<Option<A>, never>`. `Config.option` converts a *missing
key* into `Option.none()` — it does not make the effect infallible. A
**provider-source failure survives**. Probed on beta.94:

| input | result |
| --- | --- |
| key absent | `Success(Option.none())` |
| key present, value unparseable (`Config.number` over `"not-a-number"`) | **`Failure(ConfigError)`** |

A test that only exercises the absent-key path "confirms" an error channel of
`never` that is not there. Annotating the result `Effect<Option<A>, never>` is
a tsgo error.

### Providers

`ConfigProvider.fromUnknown` does **not** flatten: `Config.string("db.host")`
fails; use `Config.nested(Config.string("host"), "db")`. And `orElse` changed
arity — v3's `orElse(self, () => that)` `LazyArg` form is now
`orElse(self, that: ConfigProvider)`, `dual(2)`. `tsc` catches the thunk
(TS2345); untyped JS does not, and it half-works — succeeding for keys the
primary holds and throwing only on the fallback path.

Two constructs common in v3 **test setup** are gone. `ConfigProvider.fromMap(new
Map([...]))` → `ConfigProvider.fromUnknown({ ... })` — a plain object tree, not a
`Map`; `fromMap` no longer exists. And `Effect.withConfigProvider(p)(eff)` →
`eff.pipe(Effect.provide(ConfigProvider.layer(p)))` — `withConfigProvider` was
removed; provide the provider as a `Layer`.
