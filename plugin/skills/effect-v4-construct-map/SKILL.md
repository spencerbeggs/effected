---
name: effect-v4-construct-map
description: Comprehensive Effect v3→v4 migration reference — the single lookup for "what did this v3 API become in v4." Use when porting Effect v3 code or reaching for a v3 API name (Context.Tag, Either, Schema variadic unions, filter combinators, Metric.tagged, Cause guards, forkDaemon), and when reaching for SQL (@effect/sql is gone — the core moved into effect/unstable/sql; covers SqlClient, sql identifiers, withTransaction rollback semantics and the forward-only Migrator). Per-domain rename/restructure tables verified against the installed effect beta. Consult BEFORE reaching for a v3 name; verify anything not listed against the installed package, not memory.
---

# Effect v3 → v4 migration reference

The single place to look up what a v3 construct became in v4. Each domain is a
rename/restructure table (v3 → v4); the idiomatic *v4 way* to write the code
lives in the five best-practices skills cross-referenced below — this skill is
the lookup, not the tutorial.

**Ethos — verify against the installed package, not memory.** Everything below
is verified against `effect@4.0.0-beta.94`. v4 betas move fast: when an API is
not listed here, check `node_modules/effect/dist/` for the module and its
`.d.ts` signature before writing code. Never trust v3 muscle memory. One runtime
probe beats an hour of type-error archaeology — see [How to verify
quickly](#how-to-verify-quickly).

## Core & modules

Removed or fundamentally changed modules:

| v3 | v4 |
| --- | --- |
| `Either` module / `Effect.either(fx)` | **Gone.** `Effect.result(fx)` → `Effect<Result<A, E>>`; branch with `Result.isSuccess` / `Result.isFailure` (from `effect/Result`). Tests: `yield* Effect.result(...)` then assert `result._tag === "Success"`, or `Effect.flip` to pull the error out |
| `Runtime<R>` type | **Removed.** Use `Context<R>`. `Runtime` module now only holds `Teardown`, `defaultTeardown`, `makeRunMain` |
| `FiberRef` / `FiberRefs` / `FiberRefsPatch` / `Differ` | **Removed.** Fiber-local state is now `Context.Reference`; built-ins moved to the `References` module |
| `SortedSet` | **Removed entirely.** Use a sorted `ReadonlyArray` + `Order` (binary-search insert, dedupe on `compare === 0`) or `HashSet` when order is not needed |
| `Hash.cached(this)(h)` | **Removed.** Hash without caching; a cheap canonical form is `Hash.string(canonicalString)` |
| `effect/schema/Check` (guessed name) | Does not exist. Check combinators live on `Schema` itself as `Schema.is*` |
| `Option.fromNullable(x)` | **Gone.** `Option.fromUndefinedOr(x)` for `T \| undefined` (first boundary port; `fromNullable` `typeof` is `undefined`) |

Constructor and validation semantics (this bites *pervasively* in v3→v4 ports):

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

Idiomatic form → see `effect-v4-idioms` (construction style, `new` vs `make`).

## Schema

**`Schema.Schema` takes ONE type argument in v4.** The two-sided form is
`Schema.Codec`:

~~~ts
// v3                              // v4
Schema.Schema<A, I>                Schema.Codec<A, I>
                                   // interface Schema<out T>
                                   // interface Codec<out T, out E = T, RD = never, RE = never> extends Schema<T>
~~~

`Codec`'s never-defaulted `RD` / `RE` requirement channels are load-bearing:
they are what keeps `decodeUnknownEffect`'s `R` empty. Annotate a schema
parameter as `Schema.Codec<A, I>` when you need both sides; `Schema.Schema<A>`
when you only need the decoded type.

The largest delta set. Straight renames (auto):

| v3 | v4 |
| --- | --- |
| `asSchema(s)` | `revealCodec(s)` |
| `encodedSchema(s)` | `toEncoded(s)` — the v3 name is **gone**, not renamed in place |
| `typeSchema(s)` | `toType(s)` |
| `compose(b)` | `decodeTo(b)` |
| `annotations(ann)` | `annotate(ann)` |
| `decodingFallback` annotation | `catchDecoding(...)` |
| `parseJson()` | `UnknownFromJsonString` (a value/schema, not a fn) |
| `parseJson(schema)` | `fromJsonString(schema)` |
| `pattern(regex)` | `check(isPattern(regex))` |
| `nonEmptyString` | `isNonEmpty` |
| `BigIntFromSelf` | `BigInt` |
| `SymbolFromSelf` | `Symbol` |
| `URLFromSelf` | `URL` |
| `RedactedFromSelf` | `Redacted` (input already `Redacted`) |
| `Redacted` | `RedactedFromValue` (decodes raw → wraps) |
| `EitherFromSelf` | `Result` |
| `TaggedError` / `Data.TaggedError` | `TaggedErrorClass` (schema-backed, yieldable, serializable, `instanceof Error`) |
| `decodeUnknown` | `decodeUnknownEffect` |
| `decode` | `decodeEffect` |
| `decodeUnknownEither` | `decodeUnknownExit` |
| `decodeEither` | `decodeExit` |
| `encodeUnknown` | `encodeUnknownEffect` |
| `encode` | `encodeEffect` |
| `encodeUnknownEither` | `encodeUnknownExit` |
| `encodeEither` | `encodeExit` |
| `equivalence` | `toEquivalence` |
| `arbitrary` | `toArbitrary` |
| `pretty` | `toFormatter` |
| `standardSchemaV1` | `toStandardSchemaV1` |

`*FromSelf` suffix dropped (the un-suffixed name is now the self schema):
`DateFromSelf`→`Date`, `DurationFromSelf`→`Duration`, `ChunkFromSelf`→`Chunk`,
`ReadonlyMapFromSelf`→`ReadonlyMap`, `ReadonlySetFromSelf`→`ReadonlySet`,
`HashMapFromSelf`→`HashMap`, `HashSetFromSelf`→`HashSet`,
`BigDecimalFromSelf`→`BigDecimal`, `CauseFromSelf`→`Cause`,
`ExitFromSelf`→`Exit`, `OptionFromSelf`→`Option`, `RegExpFromSelf`→`RegExp`.

Filter renames — all now `is*`, applied via `.check(...)`:

| v3 | v4 |
| --- | --- |
| `greaterThan` | `isGreaterThan` |
| `greaterThanOrEqualTo` | `isGreaterThanOrEqualTo` |
| `lessThan` | `isLessThan` |
| `lessThanOrEqualTo` | `isLessThanOrEqualTo` |
| `between` | `isBetween` |
| `int` | `isInt` |
| `multipleOf` | `isMultipleOf` |
| `finite` | `isFinite` |
| `minLength` | `isMinLength` |
| `maxLength` | `isMaxLength` |
| `length` | `isLengthBetween` |
| `positive` / `negative` / `nonNegative` / `nonPositive` | **Removed** (compose `isGreaterThan(0)` etc.) |

Variadic → array / restructure:

| v3 | v4 |
| --- | --- |
| `Literal(null)` | `Null` |
| `Literal("a", "b")` (variadic) | `Literals(["a", "b"])`; single `Literal("a")` stays single-arg |
| `pickLiteral("a", "b")` | `Literals([...]).pick(["a", "b"])` |
| `Union(A, B)` (variadic) | `Union([A, B])` (array) |
| `Tuple(A, B)` | `Tuple([A, B])` |
| `TemplateLiteral(A, B)` | `TemplateLiteral([A, B])` |
| `TemplateLiteralParser(A, B)` | `TemplateLiteralParser(schema.parts)` |
| `Record({ key, value })` | `Record(key, value)` (positional) |
| `filter(predicate)` | `check(makeFilter(predicate))` |
| `filter(refinement)` | `refine(refinement)` |
| `UUID` | `String.check(isUUID())` |
| `ULID` | `String.check(isULID())` |
| `pick("a")` | `mapFields(Struct.pick(["a"]))` |
| `omit("a")` | `mapFields(Struct.omit(["a"]))` |
| `partial` | `mapFields(Struct.map(Schema.optional))` |
| `partialWith({ exact: true })` | `mapFields(Struct.map(Schema.optionalKey))` |
| `required(schema)` | `mapFields(Struct.map(Schema.requiredKey))` |
| `extend(structB)` | `mapFields(Struct.assign(fieldsB))` or `fieldsAssign(fieldsB)` |
| `transform(from, to, { decode, encode })` | `from.pipe(decodeTo(to, SchemaTransformation.transform({ decode, encode })))` |
| `transformOrFail(from, to, ...)` | `from.pipe(decodeTo(to, { decode: SchemaGetter.transformOrFail(...), encode: ... }))` |
| `transformLiteral(from, to)` | `Literal(from).transform(to)` |
| `transformLiterals(...)` | `Literals([...]).transform([...])` |
| `attachPropertySignature("k", "v")` | `mapFields(f => ({ ...f, k: tagDefaultOmit("v") }))` |

> `mapFields` is an **instance method** on struct schemas (`St.mapFields(...)`),
> NOT a `Schema.mapFields` static.
>
> Top-level `Schema.transform` / `Schema.transformOrFail` **do not exist as
> callables** in beta.94 (`typeof` is `undefined`; calling throws
> `Schema.transform is not a function`) — observed in the first boundary port.
> The v4 form is always `Source.pipe(Schema.decodeTo(Target,
> SchemaTransformation.transform({ decode, encode })))` (or `transformOrFail`);
> `transform` lives on `SchemaTransformation`, not `Schema`.
>
> Open struct: `Schema.Struct(fields, indexSignature)` (the 2-arg form) **runs at
> runtime but is REJECTED by tsgo** (it wants `Schema.StructWithRest` — which does
> exist). Don't reach for the 2-arg struct; model an open remainder with
> `Schema.Record(key, value)` or a `decodeTo` key-partition instead (first
> boundary port).

Removed (no v4 equivalent): `validate*` (use `decode*` + `toType`), `keyof`,
`NonEmptyArrayEnsure`, `withDefaults`, `Data(schema)` (v4 `Equal.equals` is
deep-structural by default, so `Schema.Data` is unnecessary).

Manual / case-by-case:

- `optionalWith(schema, opts)` — decision tree by option combo: `{ exact: true }`
  → `optionalKey`; `{ default }` → `withDecodingDefaultType`;
  `{ exact, default }` → `withDecodingDefaultTypeKey`; `{ nullable }` → wrap in
  `NullOr` + `decodeTo` + `Option.filter(Predicate.isNotNull)`
  (+ `Option.orElseSome` when `default`).
  **`{ default }` needs a second half:** the `withDecodingDefault*` family covers
  decode only, but v3 `optionalWith(S, { default })` also defaulted at class
  construction — for parity compose `Schema.withConstructorDefault(...)` on the
  same field, or `X.make({})` throws `Missing key` where v3 filled the default
  (probed beta.94: decode-only → `make({})` throws; composed pair → `{"deps":{}}`.
  Worked example: `@effected/lockfiles` `ResolvedPackage.dependencies`).
- `optionalToOptional` / `optionalToRequired` / `requiredToOptional` →
  `decodeTo` + `SchemaGetter.transformOptional`.
- `filterEffect` →
  `decode({ decode: SchemaGetter.checkEffect(...), encode: SchemaGetter.passthrough() })`.
- `fromKey` / `rename({ a: "c" })` → `encodeKeys({ a: "c" })` (experimental).
- `asserts(schema)(input)` → `asserts(schema, input)` (single call, no longer curried).
- `format(schema)` → `SchemaRepresentation.fromAST(S.ast)` → `toMultiDocument` → `toCodeDocument`.
- `ParseResult.ArrayFormatter.formatError(err)` →
  `SchemaIssue.makeFormatterStandardSchemaV1()(err.cause).issues`.
- `Capitalize` / `Lowercase` / etc. →
  `String.pipe(decodeTo(String.check(isCapitalized()), SchemaTransformation.capitalize()))`.
- `NonEmptyTrimmedString` → `Trimmed.check(isNonEmpty())`.
- `split(sep)` → hand-rolled `String.pipe(decodeTo(Array(String), SchemaTransformation.transform({...})))`.

Module-name changes for imports — the v3 `ParseResult` module split apart:

| v3 import | v4 import |
| --- | --- |
| `ParseResult` (failure ctors: `InvalidValue`, `MissingKey`, `Composite`, `isIssue`) | `SchemaIssue` |
| `ParseResult` (the thrown parse error) | `SchemaError` |
| `ParseResult` (getters: `transformOrFail`, `transformOptional`, `checkEffect`, `passthrough`, `String`) | `SchemaGetter` |
| `ParseResult` (transformations: `transform`, `transformOrFail`, `capitalize`) | `SchemaTransformation` |
| `ParseResult` (`format` machinery) | `SchemaRepresentation` |
| `Either` | `Result` |

> Derived-tooling exact names: `toJsonSchemaDocument` (**not** `toJsonSchema`),
> `toEquivalence`, `toFormatter`, `toStandardSchemaV1`.

Idiomatic form → see `effect-v4-schema` (Class-vs-Struct decision,
`FromString` static codec, `optionalKey` vs `optional`, `refine` vs `makeFilter`,
derived tooling, brand/opaque, "don't duplicate schemas").

## Services & Layers

`Context.Tag`, `Context.GenericTag`, `Effect.Tag`, and `Effect.Service` **all
collapse to `Context.Service`**, with the type-params-first / id-string-second
arg order (the reverse of v3).

| v3 | v4 |
| --- | --- |
| `Context.Tag("id")<Self, Shape>()` | `Context.Service<Self, Shape>()("id")` — class form; type params first, then `()`, then the id |
| `Context.GenericTag<T>(id)` | `Context.Service<T>(id)` (function form) |
| `Effect.Tag(id)<Self, Shape>()` | `Context.Service<Self, Shape>()(id)` |
| `Effect.Service<Self>()(id, { effect, dependencies })` | `Context.Service<Self>()(id, { make })` + build the layer yourself; **no `dependencies` option** (wire via `Layer.provide`) |
| `Effect.Tag` static accessor proxy (`Svc.method(...)`) | **Removed.** `Svc.use((s) => ...)` / `Svc.useSync(...)`, but **prefer `yield*`** |
| Auto-generated `.Default` layer | **None.** Define `static readonly layer = Layer.effect(this, this.make)` |
| Layer named `Default` / `Live` | named `layer` (+ `layerTest`, `layerConfig`) |
| `Layer.scoped(...)` | **`Layer.effect(...)`** — it now covers scoped/resource-owning layers (strips `Scope` from `R`); `Layer.scoped` is gone |
| `Context.Reference<Self>()(id, opts)` | `Context.Reference<T>(id, opts)` (function form) |
| per-`provide` memoization scope | shared `MemoMap` across provides (built once); opt out via `Layer.fresh` or `Effect.provide(layer, { local: true })` |
| `Context.make` / `get` / `add` / `mergeAll` | unchanged (`Context.get(map, tag)`) |

> `Layer.effect` / `Layer.succeed` are **dual**: both the curried
> `Layer.effect(Svc)(effect)` and data-first `Layer.effect(Svc, effect)`
> compile in beta.94.

### The tag's *parameter type* is `Context.Key`, not `Context.Tag`

The table above is the **class-definition** site. When you *accept a tag as a
parameter* — writing a generic layer builder, say — the type is `Context.Key`:

~~~ts
const layer = <Self, A, I, RR = never>(
  tag: Context.Key<Self, ConfigFileShape<A>>,   // NOT Context.Tag — that name is gone
  options: ConfigFileOptions<A, I, RR>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | RR> => …
~~~

Three facts that cost real debugging time:

- **`Context.Key` is type-only.** `typeof Context.Key === "undefined"` at
  runtime, indistinguishable from "removed" under the obvious probe. So is
  `Context.Tag`. Check the `.d.ts`, not `typeof`.
- **`Key<out Identifier, out Shape>` — `Shape` is covariant.** A tag for a wider
  service satisfies a parameter typed for a narrower one. `Service` and
  `ServiceClass` are declared `in out Shape`, but **both extend `Key`**, so the
  invariance does not save you. Consequence: you *cannot* subtract a method from
  a service at a layer boundary — a "read-only" overload will typecheck and then
  the method will be missing at runtime. A service's shape is fixed at its
  `Context.Service` declaration.
- **`Context.Key` extends `Effect`.** `Effect.flatMap(tag, f)` needs no
  `.asEffect()`.

Idiomatic form → see `effect-v4-services-layers` (`Context.Service` class vs
function form, `use`/`useSync` vs `yield*`, layer composition
`provide`/`provideMerge`/`mergeAll`, memoization discipline, `ManagedRuntime`).

## Core idioms

Error handling — `catchAll*` → `catch*`, `catchSome*` → `catch*Filter`:

| v3 | v4 |
| --- | --- |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchAllDefect` | `Effect.catchDefect` (same shape, renamed) |
| `Effect.catchSome` (Option-returning fn) | `Effect.catchFilter` (takes a `Filter`, e.g. `Filter.fromPredicate`) |
| `Effect.catchSomeCause` | `Effect.catchCauseFilter` |
| `Effect.catchSomeDefect` | **Removed** |
| `Effect.catchTag` / `catchTags` / `catchIf` | unchanged |
| — (new in v4) | `Effect.catchReason` / `catchReasons` / `catchEager` |

Generators, yieldables, forking, runtime, scope, cause, equality:

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
| Cause shape | recursive tree (`Sequential`/`Parallel`/…) | flat `{ reasons: Reason[] }`, `Reason = Fail \| Die \| Interrupt` |
| Cause empty | `Cause.isEmptyType(c)` | `c.reasons.length === 0` |
| Exit → cause | `Exit.causeOption(exit)` | **Gone.** `Exit.getCause(exit)` → `Option<Cause<E>>` |
| Fail vs Die | inspect the tree | `Cause.hasFails(c)` / `Cause.hasDies(c)` / `Cause.hasInterrupts(c)` |

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

### `Config` accessors are lowercase — and the capitalized names are Schemas

`Schema.String` teaches you that capitalized is the v4 name. **That
generalization is wrong for `Config`.**

| you want | v4 |
| --- | --- |
| `Config.String("port")` | `Config.string("port")` — `Config.String` is `undefined` |
| `Config.Number(...)` | `Config.number(...)` |
| — | `Config.Boolean` / `Config.Port` / `Config.LogLevel` **exist but are Schemas, not Configs** |

`ConfigProvider.fromUnknown` does **not** flatten: `Config.string("db.host")`
fails; use `Config.nested(Config.string("host"), "db")`. And `orElse` changed
arity — v3's `orElse(self, () => that)` `LazyArg` form is now
`orElse(self, that: ConfigProvider)`, `dual(2)`. `tsc` catches the thunk
(TS2345); untyped JS does not, and it half-works — succeeding for keys the
primary holds and throwing only on the fallback path.

### `@effect/platform-node`

`NodeContext` **does not exist** in `@effect/platform-node@4.0.0-beta.94`. The
aggregate is `NodeServices`. And `NodeFileSystem.layer` alone does not satisfy
`FileSystem.FileSystem | Path.Path` — compose
`Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)`.
| Cause type guards | `isFailType` / `isDieType` / `isInterruptType` | `isFailReason` / `isDieReason` / `isInterruptReason` |
| Cause presence | `isFailure` / `isDie` / `isInterrupted` / `isInterruptedOnly` | `hasFails` / `hasDies` / `hasInterrupts` / `hasInterruptsOnly` |
| Cause seq/par | `Cause.sequential` / `parallel` | `Cause.combine` (seq/par distinction gone) |
| Cause find | `failureOption` / `failureOrCause` / `dieOption` / `interruptOption` | `findErrorOption` / `findError` (→ `Result`) / `findDefect` / `findInterrupt` |
| Cause collect | `Cause.failures(c)` / `defects(c)` | `c.reasons.filter(Cause.isFailReason)` / `isDieReason` |
| `*Exception` classes | `NoSuchElementException`, `TimeoutException`, … | `NoSuchElementError`, `TimeoutError`, … (+ `isXError` guards); `RuntimeException` / `InterruptedException` removed |
| Scope extend | `Scope.extend` | `Scope.provide` |
| get runtime | `Effect.runtime<R>()` | `Effect.context<R>()` |
| run with runtime | `Runtime.runFork(rt)(program)` | `Effect.runForkWith(services)(program)` |
| Equal default | reference (needs `structuralRegion`) | **structural by default** |
| Equal opt-out | — | `Equal.byReference(obj)` / `Equal.byReferenceUnsafe(obj)` |
| Equal NaN | `Equal.equals(NaN, NaN)` → `false` | → `true` |
| Equal equivalence | `Equal.equivalence()` | `Equal.asEquivalence()` |

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

Idiomatic form → see `effect-v4-idioms` (`Effect.gen` vs `Effect.fn` split,
`catchTag`/`match` recovery patterns, errors as `TaggedErrorClass`, structural
equality motivation, `ManagedRuntime` for multiple entrypoints).

## SQL

**`@effect/sql` as a standalone package is gone.** The SQL core moved into `effect`
itself, under `effect/unstable/sql/*` — `SqlClient`, `SqlError`, `Statement`,
`SqlSchema`, `SqlResolver`, `SqlModel`, `SqlStream`, `Migrator`. There is no
`@effect/sql` to install; it does not resolve from a v4 package.

| v3 | v4 |
| --- | --- |
| `import { SqlClient } from "@effect/sql"` | `import { SqlClient } from "effect/unstable/sql"` |
| `@effect/sql` + a driver package + `@effect/platform` peer chain | the **driver alone**, peering on `effect` and nothing else |
| `@effect/sql-sqlite-node` over `better-sqlite3` | over Node's built-in **`node:sqlite`** (`DatabaseSync`) — no native module to compile |

Only the *driver* is a dependency: `@effect/sql-sqlite-node@4.0.0-beta.97` declares
`peerDependencies: { effect: "^4.0.0-beta.97" }` and **no `dependencies` at all**. The
v3 habit of also installing `@effect/sql` and `@effect/platform` is now wrong. Four
behaviours worth knowing before you design against it:

- **`SqliteClient.layer` has NO error channel** — it is
  `Layer.Layer<SqliteClient | SqlClient.SqlClient>` (`SqliteClient.ts:347`). A
  construction failure (unopenable file, bad options) surfaces as a **defect**, not a
  typed error, so do not write a `catchTag` for it. The config-driven sibling
  `layerConfig` *does* carry `Config.ConfigError` (`:327`) — that is the one to reach
  for when the connection is configured from the environment.
- **`sql(name)` interpolates an identifier.** The template form
  ``sql`SELECT …` `` builds a `Statement`; calling the same `sql` with a plain string
  returns an `Identifier` (`Statement.ts` `Constructor`, `(value: string): Identifier`),
  so `` sql`SELECT * FROM ${sql(table)}` `` parameterizes the *table name* safely.
  `sql.unsafe` and `sql.literal` are the un-escaped escape hatches.
- **`sql.withTransaction` rolls back on DEFECTS and INTERRUPTS, not just typed
  failures.** It takes the `Exit` of the body and commits **only** on
  `Exit.isSuccess` (`SqlClient.ts:222` `makeWithTransaction`) — every other exit rolls
  back. Probed live on `effect@4.0.0-beta.97` against a `:memory:` database, with a
  positive control proving the probe can observe a commit: typed failure, `Effect.die`
  and `Effect.interrupt` each rolled back. A defect will not leave a half-written
  transaction committed — but neither is it a way to *keep* partial work.
- **`Migrator` is forward-only.** `effect/unstable/sql/Migrator` exists, with loaders
  (`fromFileSystem`, `fromGlob`, `fromRecord`, `fromBabelGlob`), but there is **no down
  migration, no rollback and no status command** — the words do not appear in the
  module. Migrations are append-only; to undo one you write a new forward migration.

## Observability

| v3 | v4 |
| --- | --- |
| `Metric.tagged(...)` / `Metric.taggedWithLabels(...)` | **Removed.** `Metric.withAttributes(...)` (global `Metric.CurrentMetricAttributes` fiber ref for ambient attrs) |
| `Metric.timerWithBoundaries(...)` | `Metric.timer(...)` |
| `MetricBoundaries.*` (linear/exponential/fromChunk) | `Metric.linearBoundaries` / `Metric.exponentialBoundaries` / `Metric.boundariesFromIterable` (on the `Metric` surface) |
| span/stack-frame ergonomics via `Effect.gen` + manual `withSpan` | `Effect.fn("name")(function* …)` is now the **default constructor** for reusable business ops (auto span + stack frames); `Effect.fn(function* …)` (no name) keeps frames without a named span; `Effect.fnUntraced` is the measured-hot-path escape hatch |
| attach a metric to an effect | `Effect.track(metric)` (post-processing arg to `Effect.fn`) |

Stable/unchanged in v4 (present in beta.94): `Effect.withSpan`,
`withSpanScoped`, `withParentSpan`, `annotateCurrentSpan`, `withLogSpan`, the
`Effect.log*` family. OTel bridge layers (`NodeSdk.layer`, `Tracer.layer`,
`Metrics.layer`, `Logger.layer`) live in `@effect/opentelemetry` — **not
installed in this monorepo**, so verify their option shapes against the actual
v4-beta package before citing exact names.

Idiomatic form → see `effect-v4-observability` (boundary-only instrumentation,
telemetry-agnostic libraries, tracing-vs-stack-frame distinction, OTel at the
app edge).

## Testing

`Either`-based test assertions (`Effect.either` + `Either.isLeft`) become
`Effect.result` + `Result.isSuccess` / `isFailure` (or `result._tag ===
"Success"`), or `Effect.flip` to surface the error channel.

Idiomatic form → see `effect-v4-testing` (`@effect/vitest`, `it.effect`, mock
layers, error-path testing).

## How to verify quickly

One runtime probe beats an hour of type-error archaeology — **but a probe that
answers from the wrong place is worse than no probe**, because it confirms a
conclusion with total confidence. Four rules, each earned:

**1. `cd` into the package. Print the resolved version inside the probe.**
The repo root resolves `effect@3.x`; only `packages/<pkg>/` resolves the v4
beta. A root-run probe reports the **v3** surface — and will sometimes *agree*
with the v4 answer by luck, which no working-directory warning can catch.

~~~bash
cd packages/<pkg> && node --input-type=module -e "
const v = (await import('effect/package.json', { with: { type: 'json' } })).default.version;
console.log('resolved effect:', v);   // must be 4.x, or your answer is meaningless
import * as S from 'effect/Schema';
console.log(typeof S.TheApiYouWant);
"
~~~

**2. `typeof x === 'undefined'` does NOT mean "removed".** Type-only exports
(`Context.Key`, `Context.Tag`) are `undefined` at runtime while being perfectly
alive in the `.d.ts`. For a type, read `node_modules/effect/dist/*.d.ts` —
note the declarations are at `dist/`, **not** `dist/dts/`.

**3. A probe file must LIVE inside the package.** Bare specifiers resolve from
the file's location, not the cwd, so a probe copied to `/tmp` cannot resolve
`effect` at all. But the tsconfig `include` is `${configDir}/*.ts` and does
**not** match subdirectories — a probe in a subdir silently falls out of the
compilation program and gives a **false pass** on a deliberate control error.
Put it at the package root. **Run your control error FIRST**, confirm it fires,
then test the real thing. Delete it by *absolute* path immediately — a probe
left at the package root breaks every other agent's `types:check`.

**4. Construct memoized global state in the same order the code under test
will.** `ConfigProvider.fromEnv()` snapshots `process.env` at construction and
`Context.Reference` memoizes; a probe that reads the reference before setting
the var "proves" the provider ignores the environment.

For dual/curried APIs, probe the arity (`L.effect.length`).

**When a shell tool errors, that is not an answer.** `rg` against a nonexistent
path prints an error that reads like a clean no-match; `rg -E` is parsed as
`--encoding` under the `ugrep` alias and dies. Never pair a search with an
`|| echo "absent"` fallback — the failure becomes the conclusion. Verify the
path exists first.
