---
name: effect-v4-construct-map
description: Comprehensive Effect v3→v4 migration reference — the single lookup for "what did this v3 API become in v4." Use when porting Effect v3 code or reaching for a v3 API name (Context.Tag, Either, Effect.async, Schedule.compose, Schema variadic unions, filter combinators, Metric.tagged, Cause guards, forkDaemon, Config accessors), and when reaching for SQL (@effect/sql is gone — the core moved into effect/unstable/sql) or a CLI (@effect/cli is dead on the v4 line — see effect-v4-cli). Per-domain rename/restructure tables verified against the installed effect beta. Consult BEFORE reaching for a v3 name; verify anything not listed against the installed package, not memory.
---

# Effect v3 → v4 migration reference

The single place to look up what a v3 construct became in v4. The per-domain
tables live in [`references/`](./references/) — load the one domain you need.
The idiomatic *v4 way* to write the code lives in the best-practice skills
cross-referenced below; this skill is the lookup, not the tutorial.

**Ethos — verify against the installed package, not memory.** Everything here is
verified against `effect@4.0.0-beta.94`. v4 betas move fast: when an API is not
listed, check `node_modules/effect/dist/` for the module and its `.d.ts`
signature before writing code. Never trust v3 muscle memory. One runtime probe
beats an hour of type-error archaeology — see
[references/verifying.md](./references/verifying.md).

## The consolidated core — check here before inventing anything

The official orientation (`MIGRATION.md` in the vendored effect-smol source):
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
  to top level as they stabilize): `ai`, `cli`, `cluster`, `devtools`,
  `encoding`, `eventlog`, `http`, `httpapi`, `jsonschema`, `observability`,
  `persistence`, `process`, `reactivity`, `rpc`, `schema`, `socket`, `sql`,
  `workflow`, `workers`.

The mappings this split makes non-guessable:

| v3 | v4 | note |
| --- | --- | --- |
| `@effect/platform/Command` | `effect/unstable/process` **`ChildProcess`** | `Command` values are pure data AND yieldable Effects |
| `@effect/platform/CommandExecutor` | `effect/unstable/process` **`ChildProcessSpawner`** | the service contract; platform packages implement it |
| `@effect/platform/KeyValueStore` | `effect/unstable/persistence/KeyValueStore` | with `layerMemory`/`layerFileSystem`/`layerSql` |
| `NodeContext.layer` | **`NodeServices.layer`** (`@effect/platform-node`) | provides `ChildProcessSpawner \| Crypto \| FileSystem \| Path \| Stdio \| Terminal` |

**The rule this section exists for:** before designing any service, seam, or
vocabulary, grep the vendored core (`.repos/effect-smol/packages/effect/src`,
including `unstable/`) for an existing contract. If core declares it, require
it in `R` and let the app provide the platform layer — do not re-declare or
re-implement it. A parallel subprocess vocabulary survived four review gates
in this repo before a source check deleted it.

## Reference map

| Reference | Load when |
| --- | --- |
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
| `Effect.makeSemaphore` | **Gone.** `Semaphore` is a top-level module: `Semaphore.make(n)` (Effect) / `makeUnsafe(n)`, then `sem.withPermits(1)(effect)` | `migration/forking.md` never mentions the removal (`Semaphore.ts:329,190,80`) |
| `RequestError` / `ResponseError` (`@effect/platform` http) | one **`HttpClientError`** wrapper class carrying a `reason` union (`TransportError \| EncodeError \| InvalidUrlError \| ResponseError`) | branch on `error.reason._tag === "TransportError"`, never the top-level `_tag` — it is always `"HttpClientError"`; timeouts are separate (`Cause.isTimeoutError`). Proven in the ts-vfs fetcher's retry-only-transient policy (`HttpClientError.ts:34,293`) |
| `Exit.causeOption` | `Exit.getCause` → `Option<Cause<E>>` | |
| `Schedule.compose` | **Gone.** `Effect.retry(fx, { schedule, times, while })` | the limit is a key, not a composed schedule |
| `Context.Tag` / `Effect.Service` | `Context.Service<Self, Shape>()("id")` | type params FIRST, then the id |
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
- **`Config.string(...).asEffect()`** — `Config<T>` already **is** an
  `Effect<T, ConfigError>`; it pipes straight into `Effect.catchTag`.
- **`NodeContext`** in `@effect/platform-node` — the aggregate is `NodeServices`.
- **`@effect/cli`** — dead on the v4 line. The CLI framework is
  `effect/unstable/cli` in core. See `effect-v4-cli`.

## Related skills

- **`effect-v4-schema`** — Class-vs-Struct, codecs, `optionalKey`, derived tooling.
- **`effect-v4-services-layers`** — `Context.Service` form, layer composition, memoization.
- **`effect-v4-idioms`** — generators, typed errors, scope, forking, equality.
- **`effect-v4-cli`** — the v4 CLI: `effect/unstable/cli`, `Command.Environment`, exit codes.
- **`effect-v4-observability`** — spans, logs, metrics, OTel at the app edge.
- **`effect-v4-testing`** — `@effect/vitest`, `it.effect`, test layers.
- **`effect-v4-source-lookup`** — when this map is silent, or the question is behavioural.
