# Core idioms — v3 → v4

Surface (existence, signatures, source line citations) verified against
`effect@4.0.0-rc.109`. Rows stamped `probed at beta.N` are runtime-behaviour
claims carried forward at that stamp — plausible and previously measured, not
re-probed at rc.109. Idiomatic form → see `effect-v4-idioms`.

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
| `FiberRef` / `FiberRefs` / `FiberRefsPatch` | **Removed.** Fiber-local state is now `Context.Reference`; built-ins moved to the `References` module |
| `Differ` | **NOT removed** — `effect/Differ` is live at rc.109. `migration/fiberref.md:3` lists it among the removals and is wrong; the machine-readable import map disagrees with its own prose (`migration/v3-to-v4.md:223` maps `effect/Differ -> effect/Differ`). The interface survives, now unbranded/structural, with the patch application arity changed to `patch(oldValue, patch)` (`v3-to-v4.md:9393`). What *did* go is the `Chunk` patch namespace → RFC 6902 via `JsonPatch` |
| `SortedSet` | **Removed entirely.** Use a sorted `ReadonlyArray` + `Order`, or `HashSet` when order is not needed |
| `Hash.cached(this)(h)` | **Removed.** Hash without caching; a cheap canonical form is `Hash.string(canonicalString)` |
| `effect/schema/Check` (guessed name) | Does not exist. Check combinators live on `Schema` itself as `Schema.is*` |
| `Option.fromNullable(x)` | **Gone**, and split three ways — pick by what the value can actually be. `Option.fromNullishOr(x)` is the 1:1 replacement (`x == null`, so both `null` and `undefined` → `none`), and is what `migration/v3-to-v4.md:12128` maps it to. `Option.fromUndefinedOr(x)` (`x === undefined` only) and `Option.fromNullOr(x)` (`x === null` only) are narrower and return the tighter `Exclude<A, undefined>` / `Exclude<A, null>` rather than `NonNullable<A>` — prefer one of these when the type admits only one of the two, which is the common case (`Map.get`, an absent SQL row → `undefined`). The compiler names the module but not the replacement, so this is a guess without the table. Verified absent/present in `Option.ts` at rc.109 (`fromNullishOr:773`, `fromUndefinedOr:807`, `fromNullOr:841`) |
| `Array.fromNullable(x)` | **Gone.** `Array.fromNullishOr(x)` (`Array.ts:4073`) — nullish → `[]`, anything else → a singleton |
| `Either.fromNullable(x)` | **Gone** with the whole `Either` module. `Result.fromNullishOr(x, (a) => myError)` (`Result.ts:398`) — `onNullish` is a **function**, not a value, and the pair is `dual`, so the data-last form takes it alone |
| `Effect.fromNullable(x)` | **Gone**, and the migration notes misroute it: `v3-to-v4.md:9695` maps it to `Effect.fromOption + Option.fromNullable`, but `Option.fromNullable` does not exist in v4 either. Compose `Effect.fromOption(Option.fromNullishOr(x))` — or the narrower `fromUndefinedOr` / `fromNullOr` per the row above. `Effect.fromOption` is live (`Effect.ts:1816`) and defaults its failure to `Cause.NoSuchElementError`, so the error type is not the one the v3 call site chose |

## `Redacted` — the label is rendered, so a secret passed as its own label leaks completely

`Redacted.make(value, { label })` renders as `<redacted:LABEL>` and never renders the value
(`Redacted.ts:207-208`). The label is therefore the *only* text that escapes — through
`toString`, template interpolation and `JSON.stringify` alike — so this type-checks, reads
plausibly, and leaks the whole secret through every one of those paths:

~~~ts
Redacted.make(token, { label: token })   // renders <redacted:ghp_realTokenHere>
~~~

The label is for telling two redacted values apart in a log (`{ label: "github-token" }`),
never for carrying the value. Found by a consumer only from reading `Proto.toString`
(reposets, 2026-08-13); nothing in the type or the docstring warns of it.

A second trap in the same area, specific to writing leak tests: **`JSON.stringify(exit)`
serialises an error's fields, not its rendered message**, so an error that leaks only
through an overridden `message` getter passes a JSON-based assertion untouched. A leak test
needs `String(value)` and template interpolation as separate assertions.

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
| `Effect.catchAll` | `Effect.catch` — **and you cannot find this by grepping the source.** It is declared `const catch_` and re-exported as `export { catch_ as catch }` (`Effect.ts:2607, 2643`), because `catch` is a reserved word, so `grep "export const catch"` returns every *other* member of this family and misses the one you want. A consumer concluded from that grep that v4 has nothing for "handle any typed error" and fell back to `Effect.result` + `Result.isSuccess` (reposets, 2026-08-13). Confirm with a runtime probe instead: `typeof Effect.catch === "function"`, `typeof Effect.catchAll === "undefined"` |
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
| `Option`/`Result` → Effect | direct (they WERE Effect subtypes) | `Effect.fromOption(o)` (`Effect.ts:1816`) / `Effect.fromResult(r)` (`Effect.ts:1777`). **NOT `.asEffect()`** — see below |
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

Built-in FiberRefs moved to the `References` module: `currentLogLevel` →
`References.CurrentLogLevel`, `currentMinimumLogLevel` → `References.MinimumLogLevel`,
`currentLogAnnotations` → `References.CurrentLogAnnotations`, `currentLogSpan` →
`References.CurrentLogSpans`, `currentScheduler` → `References.Scheduler`,
`currentMaxOpsBeforeYield` → `References.MaxOpsBeforeYield`,
`currentTracerEnabled` → `References.TracerEnabled`, `unhandledErrorLogLevel` →
`References.UnhandledLogLevel`. (`Scheduler` and `MaxOpsBeforeYield` are declared in
`effect/Scheduler` — `Scheduler.ts:78,269` — and re-exported through `References`, so
either import path works.)

**`currentConcurrency` is the exception and has NO `References.*` key.**
`References.CurrentConcurrency` does not exist, and no `Context.Reference` in core
carries concurrency at all. Inherited concurrency was removed outright
(`migration/v3-to-v4.md:10521` — "`FiberRef.currentConcurrency` -> `none`"); pass
`{ concurrency }` explicitly to `Effect.all` / `Effect.forEach` / any combinator
that fans out. Extrapolating the `current*` → `References.Current*` pattern here
mints a name that reads as real and is `undefined` at runtime.

## `yield*` — the subtype net is gone, and `Option`/`Result` fail as DEFECTS

v3 made many types Effect subtypes. **There is no `Yieldable` trait in v4** — no
such interface is exported from core, and **`asEffect` has zero occurrences
core-wide at rc.109**. Any `.asEffect()` you remember is a v4-beta artifact
that no longer exists; calling it is `undefined is not a function`.

What may be `yield*`-ed in `Effect.gen` is exactly *what extends `Effect`*:

| yield in `Effect.gen`? | why |
| --- | --- |
| `Effect` | itself |
| `Config<T>` | `Config.ts:108` — `interface Config<out T> extends Effect.Effect<T, ConfigError>`; fails `ConfigError` |
| `Context.Key` / `Context.Service` | `Context.ts:64` — `interface Key<out I, out S> extends Effect<S, never, I>` |
| **`Option`** | **NO** — `Option.ts:75,128`: `Some`/`None` extend only `Pipeable, Inspectable` |
| **`Result`** | **NO** — `Result.ts:96,158`: `Success`/`Failure` extend only `Pipeable, Inspectable` |
| `Ref` / `Deferred` / `Fiber` | **NO** — call the module fn (`Ref.get`, `Deferred.await`, `Fiber.join`) |

**`Option` and `Result` are the dangerous pair, because they still typecheck.**
Both declare `[Symbol.iterator]()` (`Option.ts:82,136`; `Result.ts:104,166`), so
the generator protocol is satisfied and `yield* Option.some(7)` compiles clean.
At runtime the fiber loop rejects the value through `exitDie`
(`internal/effect.ts:671`, `Fiber.runLoop: Not a valid effect: some(7)`) — a
**defect**, not a typed failure, so it blows past every `Effect.catch` /
`catchTag` and surfaces far from the `yield*`. Probed at beta.107 (surface re-confirmed at rc.109).

The bridges are explicit calls: `Effect.fromOption(o)` (`Effect.ts:1816`,
defaulting `E = Cause.NoSuchElementError`) and `Effect.fromResult(r)`
(`Effect.ts:1777`). `Ref` / `Deferred` / `Fiber` are the honest case — they
fail to compile, so the migration finds them for you.

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
and does not typecheck. **Nor is it a function on anything else** — `asEffect`
has zero occurrences core-wide at rc.109, so the habit has no valid target
left. `Config` is already an Effect; `Option`/`Result` need
`Effect.fromOption` / `Effect.fromResult`.

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
