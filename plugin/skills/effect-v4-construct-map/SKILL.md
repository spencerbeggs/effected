---
name: effect-v4-construct-map
description: Comprehensive Effect v3→v4 migration reference — the single lookup for "what did this v3 API become in v4." Use when porting Effect v3 code or reaching for a v3 API name (Context.Tag, Either, Effect.async, Schedule.compose, Schema variadic unions, filter combinators, Metric.tagged, Cause guards, forkDaemon, Config accessors), and when reaching for SQL (@effect/sql is gone — the core moved into effect/unstable/sql) or a CLI (@effect/cli is dead on the v4 line — see effect-v4-cli). Per-domain rename/restructure tables verified against the installed effect release. Consult BEFORE reaching for a v3 name; verify anything not listed against the installed package, not memory.
---

# Effect v3 → v4 migration reference

The single place to look up what a v3 construct became in v4. The per-domain
tables live in [`references/`](./references/) — load the one domain you need.
The idiomatic *v4 way* to write the code lives in the best-practice skills
cross-referenced below; this skill is the lookup, not the tutorial. For what a
v4 module *is* regardless of its v3 history, see `effect-v4-module-index`.

**Ethos — verify against the installed package, not memory.** Everything here is
verified against `effect@4.0.0-rc.109`. The v4 release line moves fast: when an API is not
listed, check `node_modules/effect/dist/` for the module and its `.d.ts`
signature before writing code. Never trust v3 muscle memory. One runtime probe
beats an hour of type-error archaeology — see
[references/verifying.md](./references/verifying.md).

## The consolidated core — check here before inventing anything

The official orientation (`MIGRATION.md` in the vendored Effect source):
functionality from `@effect/platform`, `@effect/rpc`, `@effect/cluster` and
others now lives **directly in `effect`**. The packages that remain separate
are platform-, provider-, or technology-specific implementations only —
`@effect/platform-*`, `@effect/sql-*`, `@effect/ai-*`, `@effect/opentelemetry`,
`@effect/atom-*`, `@effect/vitest` — and every ecosystem package shares one
version number with `effect`.

The consolidation splits **stable vs unstable**:

- **Stable top-level `effect/*` modules** (strict semver): the former platform
  contracts `FileSystem`, `Path`, `PlatformError`, `Terminal`, `Stdio` — plus
  `Config`/`ConfigProvider`, `Cache`, `Crypto`, `Cron`, `Encoding`, and the rest
  of core.
- **`effect/unstable/*`** (breaking changes allowed in minors; modules graduate
  to top level as they stabilize) — the complete list of eighteen at rc.109:
  `ai`, `cli`, `cluster`, `devtools`, `encoding`, `eventlog`, `http`, `httpapi`,
  `observability`, `persistence`, `process`, `reactivity`, `rpc`, `schema`,
  `socket`, `sql`, `workers`, `workflow`.

There is **no `effect/unstable/jsonschema`** — JSON Schema is a *stable
top-level* module, `effect/JsonSchema` (a case-only rename of v3's
`effect/JSONSchema`, which only `tsc` catches on a case-insensitive
filesystem). And `effect/unstable/observability` ships OTLP export in core
(`Otlp`, `OtlpTracer`, `OtlpMetrics`, `OtlpLogger`, `PrometheusMetrics`) — see
[observability.md](./references/observability.md) before reaching for a
satellite.

The mappings this split makes non-guessable:

| v3 | v4 | note |
| --- | --- | --- |
| `@effect/platform/Command` | `effect/unstable/process` **`ChildProcess`** | `Command` values are pure data AND yieldable Effects |
| `@effect/platform/CommandExecutor` | `effect/unstable/process` **`ChildProcessSpawner`** | the service contract; platform packages implement it |
| `@effect/platform/KeyValueStore` | `effect/unstable/persistence/KeyValueStore` | with `layerMemory`/`layerFileSystem`/`layerSql` |
| `NodeContext.layer` | **`NodeServices.layer`** (`@effect/platform-node`) | provides `ChildProcessSpawner \| Crypto \| FileSystem \| Path \| Stdio \| Terminal` |

**The rule this section exists for:** before designing any service, seam, or
vocabulary, grep the vendored core (the tree's `packages/effect/src`,
including `unstable/` — resolve the root via `effect-v4-source-lookup`) for an
existing contract. If core declares it, require
it in `R` and let the app provide the platform layer — do not re-declare or
re-implement it. A parallel subprocess vocabulary survived four review gates
in this repo before a source check deleted it.

## Reference map

| Reference | Load when |
| --- | --- |
| [migration-checklist.md](./references/migration-checklist.md) | Starting or sweeping a v3→v4 migration of a whole library or app — the ordered, greppable checklist: dependency moves, silent behavior changes, blocking removals, then the mechanical renames. Load FIRST on any migration; the tables below settle individual lookups. |
| [schema.md](./references/schema.md) | Any `Schema` name — renames, the `is*` filters, variadic→array, the `ParseResult` split, derived tooling. The biggest delta set. |
| [core-idioms.md](./references/core-idioms.md) | `Effect` itself — construction/validation, `catch*`, async, retry, generators, forking, scope, `Cause`/`Exit`, equality, and all of `Config`. |
| [services-layers.md](./references/services-layers.md) | `Context.Tag`/`Effect.Service` → `Context.Service`, `Layer.scoped`, and the `Context.Key` parameter type. |
| [platform.md](./references/platform.md) | `@effect/platform-node` (`NodeContext` is gone) and constructing a `PlatformError`. |
| [sql.md](./references/sql.md) | Anything SQL — `@effect/sql` is gone; the core is `effect/unstable/sql`. |
| [observability.md](./references/observability.md) | `Metric.tagged`, metric boundaries, spans and `Effect.fn`. |
| [verifying.md](./references/verifying.md) | Before you trust a probe, a lint run, or a green test — the rules that make each one non-vacuous. |

## The renames that cost the most time

The ones that are **not guessable** from the v3 name, and that a plausible
mis-guess silently survives. Full context in the reference files.

| v3 | v4 | trap |
| --- | --- | --- |
| `Effect.async` | **`Effect.callback`** | nothing about "async" suggests "callback" |
| `Effect.catchAll` | `Effect.catch` | the whole `catchAll*` → `catch*` family |
| `Effect.either` | `Effect.result` (→ `Result`, not `Either`) | the `Either` module is gone |
| `Effect.fork` / `forkDaemon` | `Effect.forkChild` / `forkDetach` | |
| `Effect.makeSemaphore` | **Gone.** `Semaphore` is a top-level module: `Semaphore.make(n)` (Effect) / `makeUnsafe(n)`, then `sem.withPermits(1)(effect)` | `migration/forking.md` never mentions the removal (`Semaphore.ts:358,205,82`) |
| `RequestError` / `ResponseError` (`@effect/platform` http) | one **`HttpClientError`** wrapper class carrying a `reason` union | branch on `error.reason._tag`, never the top-level `_tag` — it is always `"HttpClientError"`; timeouts are separate (`Cause.isTimeoutError`). Proven in the ts-vfs fetcher's retry-only-transient policy (`HttpClientError.ts:34,277,285,293`). **The reason `_tag`s are not what the type names suggest** — see below |
| `Exit.causeOption` | `Exit.getCause` → `Option<Cause<E>>` | |
| `Schedule.compose` | **Gone.** `Effect.retry(fx, { schedule, times, while })` | the limit is a key, not a composed schedule |
| `Context.Tag` / `Effect.Service` | `Context.Service<Self, Shape>()("id")` | type params FIRST, then the id |
| `FiberRef` | **`Context.Reference`** (`Context.ts:1324`); the built-in runtime keys live in `References.ts` | there is no `FiberRef.ts` on the v4 line. Log level, scheduler and tracer settings are `Context.Reference`s now, set with `Effect.provideService` — but **concurrency is not one of them**, see below |
| `DateTime.unsafeMake` | **`DateTime.makeUnsafe`** (`DateTime.ts:653`) | the whole `unsafe*` → `*Unsafe` suffix flip. And the safe form changed shape: `DateTime.make` returns **`Option`** (`:793`), not a throwing constructor |
| `Schema.DateTimeUtc` encodes to an ISO string | encoded side is **`DateTime.Utc` itself** — string serialization moved out of the declare schemas; `Schema.DateTimeUtcFromString` is the string codec | v3 muscle memory says ISO string; probed at beta.101 (2026-07-26). Matters anywhere the ENCODED side is consumed as text — pick `DateTimeUtcFromString` for wire/string projections |
| `Layer.scoped` | `Layer.effect` | it already handles resource-owning layers |
| `Schema.Schema<A, I>` | `Schema.Codec<A, I>` | `Schema.Schema` takes ONE arg now |
| `Schema.transform(...)` | `from.pipe(Schema.decodeTo(to, SchemaTransformation.transform(...)))` | the top-level callable does **not exist** — it throws |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` | the variadic form **runtime-silently keeps only the first literal** |
| `Metric.tagged` | `Metric.withAttributes` | |
| `Config.String("port")` | `Config.string("port")` | capitalized `Config.*` names are **Schemas**, not Configs |
| `new FileSystem.SystemError(...)` | `PlatformError.systemError({...})` | the `new` form throws "is not a constructor" |

## Names that read as real but are not

Reaching for one of these gets `undefined` — and `undefined` fails in a place
far from the mistake.

- **`Schema.NonNegativeInt`** — does not exist, though `Schema.Int` does.
  Compose `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))`.
- **`Schema.toJsonSchema`** — it is `Schema.toJsonSchemaDocument`, and it returns
  `{ dialect, schema, definitions }`, **not** `$defs` / `properties`.
- **`ConfigError` on the `effect` root** — it is `Config.ConfigError`.
- **`.asEffect()` on anything** — `asEffect` has **zero occurrences core-wide**
  at rc.109; there is no `Yieldable` trait for it to belong to. `Config<T>`
  and `Context.Key` already **are** Effects (they pipe straight into
  `Effect.catchTag`); `Option`/`Result` convert with `Effect.fromOption` /
  `Effect.fromResult`. See [core-idioms.md](./references/core-idioms.md) — and
  note `yield* someOption` **compiles and dies as a defect**.
- **`NodeContext`** in `@effect/platform-node` — the aggregate is `NodeServices`.
- **`@effect/cli`** — dead on the v4 line. The CLI framework is
  `effect/unstable/cli` in core. See `effect-v4-cli`.
- **`Effect.withConfigProvider`** — gone, with no replacement of that name.
  `ConfigProvider.ConfigProvider` is a **`Context.Reference`**
  (`ConfigProvider.ts:341`), so overriding the provider is ordinary service
  provision:
  `Effect.provideService(effect, ConfigProvider.ConfigProvider, provider)`.
  Reach for the v3 name and you get `undefined is not a function` at the call
  site — which reads like a bad import, not a rename.
- **`References.CurrentConcurrency`** — does not exist, and neither does any
  other concurrency `Context.Reference`: grep every `Context.Reference` id in
  core and none of them mentions concurrency. **Inherited concurrency was
  removed outright** (`migration/v3-to-v4.md:10521`: "`FiberRef.currentConcurrency`
  -> `none`"). Pass `{ concurrency }` explicitly to each combinator that fans
  out — `Effect.all`, `Effect.forEach`. This is the one built-in `FiberRef` that
  did *not* become a `References.*` key, so the pattern the other rows teach
  (`currentLogLevel` → `References.CurrentLogLevel`) mints a name that is
  `undefined` at runtime.

## `HttpClientError`: the `reason` `_tag`s are not the type names

Branching on `error.reason._tag` is right; the values are the trap. The reason
type is declared in two layers, and **both layer names are themselves unions,
so neither ever appears as a `_tag`**:

~~~ts
// unstable/http/HttpClientError.ts:277,285,293
export type RequestError  = TransportError | EncodeError | InvalidUrlError
export type ResponseError = StatusCodeError | DecodeError | EmptyBodyError
export type HttpClientErrorReason = RequestError | ResponseError
~~~

So `error.reason._tag` is exactly one of **six** values — `"TransportError"`,
`"EncodeError"`, `"InvalidUrlError"`, `"StatusCodeError"`, `"DecodeError"`,
`"EmptyBodyError"`. A retry policy written as
`error.reason._tag === "ResponseError"` (or `=== "RequestError"`) **never
matches** and silently retries nothing — a live-looking branch that is dead
code. Note `ResponseError` *is* a real tagged class elsewhere, in
`HttpServerError.ts:197`; the name collision is what makes the wrong guess
feel confirmed.

## The `Config.withDefault` trap: retired in beta.102–105

`Config.withDefault` and `Config.option` fall back for **missing data only**.
Through beta.101, "missing" was judged from the **issue**: `isMissingDataOnly`
classified an `InvalidValue`/`InvalidType` whose `actual` was `Option.none()`
as missing, so a hand-built `SchemaIssue` that omitted its `actual` was
silently swallowed by any default downstream. This shipped as a live defect:
an action input written `dry-run: yes` failed validation, classified as
missing, fell back to `false` — and the rehearsal performed real mutations.
The fix then was carrying `Option.some(rawValue)` in the issue.

**beta.102–105 removed both the trap and the fix.** Issues no longer carry an
`actual: Option` at all (`SchemaIssue.InvalidValue` is now
`(annotations?, input?, options?)`, input retained only under `reportInput:
true`), `isMissingDataOnly` is gone from `Config.ts`, and the evaluator tracks
input evidence itself (`hasInput` on the resolution, `Config.ts:180–194`).
Probed on beta.105: a present-but-malformed value **fails** through
`withDefault`, and so does a hand-built
`new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue({ message })))`
with no input attached — neither silently defaults. Do not port the
`Option.some(actual)` ritual forward (it no longer compiles); do keep the
regression test — assert that a config under `withDefault` still fails, not
falls back, when fed a present-but-malformed value.

## These look like values but are calls

A distinct, nastier family: the name **does** exist, so nothing in the rename
tables catches it, and it is spelled exactly like the value you want. It is a
**factory with an optional (or no) argument**, so the uncalled reference is a
perfectly good expression — the mistake surfaces far away, as a construction
throw or a service that was never provided.

Every row verified at rung 2 against the vendored source at
`effect@4.0.0-rc.109`:

| Write | Not | Source |
| --- | --- | --- |
| `Schema.Defect()` | `Schema.Defect` | `Schema.ts:10769` — `export function Defect(options?: ErrorOptions): Defect`. The canonical case: `cause: Schema.Defect` on an error class throws at construction. |
| `Schema.ErrorInstance()` | `Schema.ErrorInstance` | `Schema.ts:10669` — `export function ErrorInstance(options?: ErrorOptions): ErrorInstance`. Same shape, same optional-`options` trap, one page away in the same module. (beta.102–105 renamed it from `Schema.Error`; `Schema.Error` is now the error-**class factory** at `Schema.ts:14427` — see schema.md.) |
| `TestClock.layer()` | `TestClock.layer` | `testing/TestClock.ts:436` — `export const layer: (options?: TestClock.Options) => Layer.Layer<TestClock>`. **A function returning a Layer**, unlike almost every other `layer` in core. |
| `Schema.Literals(["a","b"])` | `Schema.Literals` / `Schema.Literal("a","b")` | `Schema.ts:4956` — takes ONE array argument. (The variadic `Schema.Literal` trap is separate and worse: it keeps only the first literal at runtime. See the rename table above.) |

**The discriminator is the optional argument.** `Schema.Cause(e, d)`
(`Schema.ts:10493`) and `Schema.Exit(...)` (`:10831`) are factories too, but their
arguments are required, so forgetting to call them is an immediate type error.
Only the zero-or-optional-arg factories type-check uncalled.

**And do not over-correct: `layer` is usually a value.** `TestConsole.layer` is a
plain `Layer.Layer<TestConsole>` (`testing/TestConsole.ts:294`), so
`TestConsole.layer()` is an error. The pair sits in the same directory and reads
identically. Check the declaration; do not pattern-match on the name.

## Related skills

- **`effect-v4-schema`** — Class-vs-Struct, codecs, `optionalKey`, derived tooling.
- **`effect-v4-services-layers`** — `Context.Service` form, layer composition, memoization.
- **`effect-v4-idioms`** — generators, typed errors, scope, forking, equality.
- **`effect-v4-cli`** — the v4 CLI: `effect/unstable/cli`, `Command.Environment`, exit codes.
- **`effect-v4-observability`** — spans, logs, metrics, OTel at the app edge.
- **`effect-v4-testing`** — `@effect/vitest`, `it.effect`, test layers.
- **`effect-v4-source-lookup`** — when this map is silent, or the question is behavioural.
