# The v3→v4 migration checklist

The concrete, greppable list of things a v3 codebase — library or app — must
change. Run it as an ordered sweep: **dependencies first, silent behavior
changes second** (they need eyes, not sed), **removals third** (they need
design decisions), then the mechanical renames, then the domain restructures.
Compile errors are the LAST net, not the first: everything in section 2
compiles clean and behaves differently.

Every item: **grep** for the v3 pattern → what it **becomes** → the gotcha.
Sources: the official migration notes (`migration/*.md`, `MIGRATION.md` in the
vendored Effect tree) cross-checked against the @effected migration
program's recorded scars. The machine-readable import map
(`migration/v3-to-v4.md`, 290 mapped modules) is the authority when an import
is not listed here — grep it directly (or read it in the upstream
Effect-TS/effect repo if no vendored tree is present).

## 1. Dependencies and imports

- **`package.json`**: drop `@effect/cli`, `@effect/rpc`, `@effect/cluster`,
  `@effect/platform`, `@effect/experimental`, `@effect/workflow`, `@effect/ai`
  as direct deps — their exports now live in `effect` itself. Keep
  `@effect/platform-node|bun`, `@effect/sql-*`, `@effect/ai-*`,
  `@effect/atom-*`, `@effect/vitest` as separate deps. **One shared version
  number**: every `@effect/*` package must pin the beta matching `effect` —
  a mismatch is a silent incompatibility, not a type error.
- `from "@effect/platform/..."` → splits: `FileSystem`, `Path`, `Terminal`,
  `Stdio`, `PlatformError`, `ChannelSchema` are top-level `effect/*`; HTTP →
  `effect/unstable/http`, HttpApi → `unstable/httpapi`, sockets/KV/encodings/
  workers → their `unstable/*` namespaces. Trap: `platform/Command` →
  `effect/unstable/process` **`ChildProcess`**, `platform/CommandExecutor` →
  **`ChildProcessSpawner`** — the names diverge from the module name.
- `from "@effect/cli"` → `effect/unstable/cli`, AND four renames ride along:
  `Args`→`Argument`, `Options`→`Flag`, `ValidationError`→`CliError`,
  `BuiltInOptions`→`GlobalFlag`. A path-only rewrite produces broken imports.
- `from "@effect/sql"` → `effect/unstable/sql` — but `@effect/sql/Model` has
  TWO targets (`unstable/schema/Model` vs `unstable/sql/SqlModel`): read the
  usage before picking.
- `from "@effect/typeclass/Semigroup|Monoid"` → `effect/Combiner` /
  `effect/Reducer` — names share nothing with the source; grep symbol usage
  too.
- `import { Either }` / `Either.left|right` → `Result` / `Result.fail|succeed`.
  The `Either` module is gone; `_tag: "Left"/"Right"` shapes change with it.
- `from "effect/FastCheck"` / `"effect/TestClock"` → `effect/testing/*`.
  `TestConsole` and `TestSchema` are v4-only — nothing in v3 hints they exist.
- `T*` STM modules (`TRef`, `TMap`, `TSet`, `TQueue`, …) → `Tx*` — but
  `TMap`→`TxHashMap` and `TSet`→`TxHashSet` change the base name too; a bare
  `T`→`Tx` prefix rewrite mints nonexistent modules.
- `from "effect/JSONSchema"` → `effect/JsonSchema` — case-only rename; on a
  case-insensitive filesystem only `tsc` catches it.
- One-to-many fan-outs needing usage reads: `effect/Inspectable` →
  `Formatter` / `Inspectable` / `Redactable`; `effect/ParseResult` →
  `SchemaIssue` / `SchemaParser`; `effect/FiberRef` → `effect/References`.
- Everything under `effect/unstable/*` may break in MINOR releases — flag
  those imports as semver-looser even though they live in core.

## 2. Silent behavior changes — audit, do not sed

These compile clean in both versions and behave differently. Grep finds the
call sites; only reading finds the broken intent.

- **`Equal.equals` is structural by default.** v3 code relying on reference
  semantics for correctness (cache keys, dedup, memo comparisons) silently
  starts matching distinct-but-equal objects. Opt out with
  `Equal.byReference(obj)`. Related: `NaN` now equals `NaN`.
- **Layer memoization is shared across `Effect.provide` calls.** A layer's
  constructor ran once per `provide` in v3; in v4 it runs once total. Test
  isolation or resource pools built on per-call rebuilds silently share
  state. Escape hatches: `Layer.fresh`, `Effect.provide(layer, { local: true })`.
- **`Schema.Redacted` keeps its name and swaps its behavior.** v3
  `Schema.Redacted(value)` (decode-then-wrap) is now `Schema.RedactedFromValue`;
  v4 `Schema.Redacted` is v3's `RedactedFromSelf`. Same-name-same-behavior is
  exactly wrong here.
- **`new X({...})` validates.** v4 Schema-class construction runs validation,
  and an explicit `undefined` on an `optionalKey` field THROWS (bites hardest
  under `exactOptionalPropertyTypes`). Grep object literals feeding
  constructors for `{ field: maybeUndefined }` — they need conditional
  spreads: `{ ...(x !== undefined ? { x } : {}) }`.
- **`Cause.sequential`/`Cause.parallel` → `Cause.combine`** flattens the
  distinction out of the data model — code that formatted or prioritized by
  sequential-vs-parallel structure has no signal left to read.
- **`Schema.TemplateLiteral` refined parts now participate in matching** —
  a checked part can reject strings v3 accepted. **`Schema.Record` refined/
  transformed key schemas** now select matching keys before validating values.
  Flag both for behavior review, not just array-wrapping.
- **`Effect.ignoreLogged` → `Effect.ignore`** — the two collapse into one
  combinator, with logging **opt-in through an options object**:
  `Effect.ignore(fx, { log: true })` (`migration/v3-to-v4.md:9709`; the options
  also take `log: Severity` and `message`). A bare `Effect.ignore(fx)` is still
  silent, so existing silent call sites are safe as-is — it is the
  `ignoreLogged` sites that change meaning if you rename them without adding
  `{ log: true }`.

## 3. Removals that block — design decisions, not renames

- `Effect.forkAll`, `Effect.forkWithErrorHandler` — fork individually with
  `forkChild` / observe results via `Fiber.join`/`Fiber.await`.
- `Effect.Tag` static accessor proxies — every `Service.method(...)` call
  site becomes `yield* Service` + method call (or `Service.use(...)`). No
  grep isolates these from ordinary namespace calls; you must know which
  classes were `Effect.Tag`-based and sweep their names.
- `Effect.Service`'s `dependencies` option and the auto-generated `.Default`
  layer — hand-write `static readonly layer = Layer.effect(this, make).pipe(Layer.provide(...))`.
  House naming: `layer`, `layerTest`, `layerConfig` — not `Default`/`Live`.
- `FiberRef` / `FiberRefs` / `FiberRefsPatch` — built-ins map to
  `References.*` keys; custom refs become `Context.Reference`. `FiberRef.set`
  has NO equivalent: its fire-and-forget mutation becomes a scoped
  `Effect.provideService` wrapped around the downstream code — a control-flow
  rewrite, not a rename. **Two exceptions to the mapping:** `Differ` is NOT
  removed (`effect/Differ` is live; `migration/fiberref.md:3` says otherwise and
  is contradicted by `migration/v3-to-v4.md:223`), and `currentConcurrency` has
  no `References.*` key at all — inherited concurrency was removed, so pass
  `{ concurrency }` per combinator (`v3-to-v4.md:10521`).
- `Runtime<R>` — use `Context<R>`; `Effect.runtime<R>()` →
  `Effect.context<R>()`; `Runtime.runFork(rt)` → `Effect.runForkWith(services)`.
  If `R` is `never`, just `Effect.runFork(effect)` — don't port the
  extraction dance. The `Runtime` module now holds only run-main plumbing —
  `Teardown`, `defaultTeardown`, `makeRunMain`, plus the `errorExitCode` /
  `errorReported` marker keys and their `getErrorExitCode` / `getErrorReported`
  readers — and nothing resembling a v3 `Runtime<R>`.
- `Effect.catchSomeDefect`; `Cause.isSequentialType`/`isParallelType`;
  `Cause.RuntimeException`/`InterruptedException`/`InvalidPubSubCapacityException`
  — gone, no replacements.
- `Schema.validate*` family — rewrite as `Schema.decode*(Schema.toType(schema))`.
  `Schema.keyof`, `Schema.NonEmptyArrayEnsure`, `Schema.withDefaults`,
  `Schema.Data` (obsolete — equality is structural now), `Schema.positive`/
  `negative`/`nonNegative`/`nonPositive` (compose `isGreaterThan(0)` etc.),
  `Schema.pluck`, `Schema.split` (hand-rolled helpers only) — all removed.
- `Mailbox` — folded into `Queue` (`Queue.make`; note `Queue<A, E>` carries an
  error channel in v4).

## 4. Core idiom renames (mechanical — sed-safe after sections 2–3)

| v3 | v4 | note |
| --- | --- | --- |
| `Effect.async` | `Effect.callback` | |
| `Effect.zipRight` | `Effect.andThen` | verify overload parity |
| `Effect.zipLeft` | `Effect.tap` | |
| `Effect.either` | `Effect.result` | returns `Result` |
| `Effect.fork` / `forkDaemon` | `Effect.forkChild` / `forkDetach` | all `fork*` gain an options object |
| `Effect.catchAll` / `catchAllCause` / `catchAllDefect` | `Effect.catch` / `catchCause` / `catchDefect` | |
| `Effect.catchSome` / `catchSomeCause` | `Effect.catchFilter` / `catchCauseFilter` | callback → `Filter` + handler: restructure, not rename |
| `Effect.optionFromOptional` | `Effect.catchNoSuchElement` | |
| `Effect.tapErrorCause` | `Effect.tapCause` | same on `Layer`/`Stream` |
| `Effect.makeSemaphore` / `makeLatch` | `Semaphore.make` / `Latch.make` | moved off `Effect` onto new modules |
| `Effect.gen(this, f)` | `Effect.gen({ self: this }, f)` | |
| `Layer.scoped` / `scopedDiscard` | `Layer.effect` / `effectDiscard` | |
| `Scope.extend` | `Scope.provide` | pure rename |
| `Equal.equivalence` | `Equal.asEquivalence` | |
| `Stream.*Chunk*` family | `Stream.*Array*` | pattern class: `Chunk`→`Array` in Stream names |
| `Stream.async` / `asyncEffect` / `asyncPush` / `asyncScoped` | `Stream.callback` | 4→1 collapse; options shapes differ — verify signatures |
| `Stream.provideSomeLayer` / `provideSomeContext` | `Stream.provide` | |

## 5. Errors and Cause — a data-model change

- `Cause` is no longer a tree. `cause._tag` matching on
  `Empty`/`Sequential`/`Parallel` and every recursive walker → iterate
  `cause.reasons` (flat `ReadonlyArray<Reason>`, `Reason = Fail | Die | Interrupt`).
  Empty is `reasons.length === 0`.
- `Cause.isFailType(cause)` → `Cause.isFailReason(reason)` — the guards now
  take a single `Reason`; call sites must iterate first.
- `Cause.isFailure`/`isDie`/`isInterrupted*` → `Cause.hasFails`/`hasDies`/
  `hasInterrupts*` — plural semantics.
- `Cause.failureOption`/`failureOrCause`/`dieOption`/`interruptOption` →
  `findErrorOption`/`findError`/`findDefect`/`findInterrupt` — and
  `findError`/`findDefect` return `Result`, not `Option`. `Cause.findFail`
  also exists and returns the `Fail<E>` WRAPPER in a `Result` (the error is
  `.success.error`) — use `findError`/`findErrorOption` when you want the
  bare `E`; agents writing from v3 memory reach for `failureOption`, which
  does not exist at all.
- `Cause.failures`/`defects` → `cause.reasons.filter(Cause.isFailReason)` etc.
- `*Exception` → `*Error` across the module (`NoSuchElementError`,
  `TimeoutError`, `IllegalArgumentError`, …) — treat as a convention sweep.

## 6. Services, Layers, References

- `class X extends Context.Tag("id")<X, Shape>() {}` →
  `class X extends Context.Service<X, Shape>()("id") {}` — **the argument
  order flips** (types first, id second); regex-only rewrites get it wrong.
  `Context.GenericTag<T>` → `Context.Service<T>(id)`.
- Built-in `FiberRef.current*` → `References.*` (`CurrentConcurrency`,
  `CurrentLogLevel`, `MinimumLogLevel`, …), read by plain `yield*` — no
  `.get()`.
- `Effect.locally(effect, ref, value)` →
  `Effect.provideService(effect, Reference, value)`.
- Layer memoization is by reference: bind every layer (especially the result
  of any parameterized layer factory) to a `const` — a layer-returning
  function called at two provide sites builds the resource twice.

## 7. Yieldable — the subtype net is gone

- `Ref`/`Deferred`/`Fiber` are no longer Effects OR Yieldables: `yield* ref`
  → `yield* Ref.get(ref)`; `yield* deferred` → `yield* Deferred.await(d)`;
  `yield* fiber` → `yield* Fiber.join(f)`.
- **There is no `Yieldable` trait and no `.asEffect()`** — `asEffect` has zero
  occurrences core-wide at rc.109. Only what extends `Effect` may be
  `yield*`-ed: `Config` (`Config.ts:108`) and `Context.Key`/service tags
  (`Context.ts:64`) do; **`Option` and `Result` do NOT** (`Option.ts:75,128`,
  `Result.ts:96,158` — they extend only `Pipeable, Inspectable`).
- **`yield* Option.some(x)` / `yield* someResult` is the worst row in this
  checklist: it COMPILES and dies as a DEFECT.** Both declare
  `[Symbol.iterator]()` (`Option.ts:82,136`; `Result.ts:104,166`), satisfying
  the generator protocol, so no type error fires; the fiber loop then rejects
  the value via `exitDie` (`internal/effect.ts:671`, "Not a valid effect"),
  which bypasses every `Effect.catch`/`catchTag`. Convert explicitly:
  `Effect.fromOption(o)` (`Effect.ts:1816`) / `Effect.fromResult(r)`
  (`Effect.ts:1777`). Grep every bare `yield*` of an `Option`- or
  `Result`-valued expression; the compiler will not find them for you.
- `Config.string("x")` IS an `Effect`, so it pipes straight into `catchTag`
  chains with no conversion — but no `Config.String` confusion: capitalized
  `Config.*` names are Schemas.

## 8. Schema — the biggest delta

Full rename tables live in [schema.md](./schema.md); the sweep order and traps:

- **Mechanical renames** (safe): `annotations`→`annotate`,
  `typeSchema`→`toType`, `encodedSchema`→`toEncoded`, `asSchema`→`revealCodec`,
  Effect-returning `decode`/`decodeUnknown`/`encode`/`encodeUnknown` →
  `*Effect` and `*Either` → `*Result`/`*Exit` — NOT a family sweep: the
  `*Sync`/`*Option`/`*Promise` variants (`encodeSync`, `decodeUnknownSync`, …)
  survive unchanged, and typed `encodeSync` beats `encodeUnknownSync` when the
  input is already `S["Type"]` — `equivalence`/`arbitrary`/`pretty` →
  `toEquivalence`/`toArbitrary`/`toFormatter`, `TaggedError`→`TaggedError`
  (the name is BACK since beta.102–105 — early v4 betas said
  `TaggedErrorClass`, and code written against those fails with
  "TaggedErrorClass is not a function"; only the v4 signature differs from v3),
  `*FromSelf` suffix dropped (`DateFromSelf`→`Date`, …) — EXCEPT `Redacted`
  (section 2).
- **Variadic → array**: `Literal("a","b")` → `Literals(["a","b"])` (the
  variadic form **silently keeps only the first literal**), `Union(A,B)` →
  `Union([A,B])`, `Tuple`, `TemplateLiteral` likewise.
- **Filter combinators** → `is*` used via `.check(...)`: `between`→`isBetween`,
  `int`→`isInt`, `minLength`→`isMinLength`, … Traps: `length`→`isLengthBetween`
  (not `isLength`), and **`isBetween` takes `{ minimum, maximum }` named
  options, not positional `(min, max)`** (`Schema.ts:7794` — the shared
  `makeIsBetween` factory, so `isBetweenDate`/`isBetweenBigInt`/
  `isBetweenBigDecimal` are named-options too). **Do not generalize that to the
  whole family: `isLengthBetween(minimum, maximum, annotations?)` IS positional**
  (`Schema.ts:8954`). The two adjacent-sounding checks disagree on argument
  shape, and each one type-errors in the other's style.
- **Struct surgery** → `.mapFields(...)`: `pick`/`omit` →
  `Struct.pick`/`Struct.omit`, `partial` → `Struct.map(Schema.optional)`,
  `extend` → `Struct.assign` (struct) or `mapMembers(Tuple.map(...))` (union).
- **`Schema.filter`** → `.check(Schema.makeFilter(...))` for predicates but
  `.pipe(Schema.refine(...))` for type-narrowing refinements — inspect the
  callback's signature to choose.
- **`Schema.transform(...)` as a top-level call does not exist** — it is
  `from.pipe(Schema.decodeTo(to, SchemaTransformation.transform({...})))`;
  `transformOrFail` callbacks now return real `Effect`s failing
  `SchemaIssue.InvalidValue`, not `ParseResult.*` — constructed as
  `new SchemaIssue.InvalidValue({ message }, input)` since beta.102–105
  (`(annotations?, input?, options?)`, no `Option` wrapper).
- **`Schema.optionalWith`** — seven option combinations map to seven
  structurally different v4 expressions; classify each call site by its exact
  options before picking a template (decision tree in the official
  `migration/schema.md`).
- **Failure model**: decode failures are `Schema.SchemaError` carrying a
  `SchemaIssue` in `.issue` — v3 `ParseResult`-based catches match nothing.
  `ArrayFormatter.formatError` → `SchemaIssue.makeFormatterStandardSchemaV1()`.
- **beta.101 → rc.109 (v4-internal)**: if the code was written against an
  earlier v4 beta, also sweep the internal moves — `TaggedErrorClass` /
  `ErrorClass` back to `TaggedError` / `Error` (same shapes; the instance
  schema is now `ErrorInstance`); `InvalidValue` to
  `(annotations?, input?, options?)`; the throwing constructor/adapter paths
  (`X.make`, class `new`, `asserts`, `SchemaParser` sync/promise) now throw a
  generic `"Schema validation failed"` `Error` with the issue on `.cause` —
  tests asserting constraint text on `.message` must format
  `SchemaIssue.makeFormatterDefault()(error.cause)` instead (probed beta.105;
  `decodeUnknownSync`'s `SchemaError.message` stays formatted);
  `<schema>.makeEffect` (an instance method — there is no module-level
  `Schema.makeEffect`) fails with `SchemaIssue.Issue`, not `SchemaError`;
  JSON Schema `$defs` keys for class schemas gained an `Encoded` suffix
  fallback (`Person` → `PersonEncoded`); and `Schema.toArbitrary` now returns
  a factory taking the fast-check module (`toArbitrary(S)(FastCheck)`), with
  `toArbitraryLazy` removed (beta.106). Full table in [schema.md](./schema.md).
- **Verify the advance UNCACHED, and check the ROOT tsconfig, not only package
  bases.** Two false negatives hit live on one wave migration
  (rspress-plugin-api-extractor → beta.107): a turbo typecheck task whose
  declared `inputs` cover only source files serves a stale CACHE HIT after a
  dependency advance — the bump touches neither source nor the task's inputs —
  so `typecheck` reports green against the OLD beta; force it
  (`TURBO_FORCE=true`) once after any dependency advance. And the
  root-vs-package-base tsconfig split is its own false negative: workspace bases
  may set `skipLibCheck` where the repo-root tsconfig does not, so per-package
  checks pass while root `tsc`/`tsgo` (often first seen in a lint-staged commit
  hook, only when a `.ts` file is staged) fails on a `dist` d.ts — align the
  root config with the bases. The instance of this that bit the beta.107 wave,
  Effect-TS/effect#7187 (`Schema.d.ts` referencing the `@internal`-stripped
  `SchemaAST.Sentinel`, failing `TS2694`), is **fixed as of rc.109**: `Sentinel`
  no longer appears anywhere in `dist/Schema.d.ts` or `dist/SchemaAST.d.ts`.
  Expect the shape of the failure to recur, not that exact symbol.
- `Schema.Schema<A, I>` (two params) → `Schema.Codec<A, I>`; `Schema.Schema`
  takes one.

## 9. Testing sweep (details: `effect-v4-testing`)

- Plain-Vitest repo? Adopt `@effect/vitest` (in `catalog:effect`, same beta pin
  as `effect`) and route Effect-returning tests through `it.effect` — it
  re-exports Vitest, so plain `it()` tests keep working. Plain Vitest is not a
  "nothing to migrate" state.
- Imports: `effect/FastCheck` → `effect/testing/FastCheck`; `TestClock` →
  `effect/testing/TestClock`.
- `it.effect` installs a virtual `TestClock` **at the epoch** — clock-reading
  code silently computes against 1970; sleeps hang to timeout. `TestClock.setTime`
  first.
- `it.effect.prop` Schema arbitraries work in the ARRAY form only — the
  named-record form silently discards the Schema→Arbitrary conversion.
- `layer(...)` builds once per describe group — stateful layer contents
  accumulate across tests; `TestConsole` buffers accumulate within a test.
- Never read a test runner's trailing-pipe output as a verdict: read the
  `Tests:` line, never the exit code of a piped invocation.

## 10. Platform-adjacent scars (proven in the @effected ports)

- `FileSystem.exists` is **directory-true** — "does this FILE exist" needs
  `stat` + `isFile()`, or the read's typed error handled; config walks and
  loader probes mis-resolve otherwise.
- HTTP errors: one `HttpClientError` wrapper class with a `reason` union —
  branch on `error.reason._tag`, never the top-level `_tag`; timeouts are
  `Cause.isTimeoutError`, separate. The `_tag` values are **not** the two type
  names in the declaration: `RequestError` and `ResponseError` are themselves
  unions (`HttpClientError.ts:277,285`), so `reason._tag` is one of
  `TransportError` / `EncodeError` / `InvalidUrlError` / `StatusCodeError` /
  `DecodeError` / `EmptyBodyError` — a branch on `"ResponseError"` never fires.
- `PubSub.publish` returns `Effect<boolean>` with `E = never` — wrapping it in
  `Effect.catch` is vacuous; the real exposure is a defect from a hostile hub
  (`Effect.catchDefect`, NOT `catchCause`, which also swallows interruption).
- `new FileSystem.SystemError(...)` → `PlatformError.systemError({...})` —
  the `new` form throws "is not a constructor".

## Verifying as you go

Anything this checklist does not settle: climb the `effect-v4-source-lookup`
ladder — the vendored source settles existence and signature; only a probe
run from inside the package (printing its resolved `effect` version) settles
semantics. The probe rules that keep a probe non-vacuous are in
[verifying.md](./verifying.md).
