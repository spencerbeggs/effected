---
name: effect-v4-module-index
description: The routing map for Effect v4 core — every module in one table, what it is, when to reach for it, and where to read it in the vendored source. Use FIRST when asking "what module do I reach for", "does Effect have a Sink/Pool/Trie/pattern-matcher", "what is Sink/Channel/Deferred/RcMap for", "where does X live in the source", or before designing ANY capability (the contract-inventory gate greps this map's territory). Rows route; they do not teach — patterns live in the other effect-v4-* skills, and the source is the authority on signatures and semantics.
---

# Effect v4 module index

Every module of `effect@4` core, one row each: **what it is**, **when to reach
for it**. This skill exists so the other skills can stop explaining what things
are and spend their space on patterns — and so no one designs a capability core
already ships (the `effect-v4-planning` contract-inventory gate).

**Where things live.** Every row's source is
`.repos/effect-smol/packages/effect/src/<Name>.ts` (testing modules under
`src/testing/`, unstable namespaces under `src/unstable/<ns>/`). The vendored
submodule is pinned to the installed beta and is the authority on existence,
signatures, and — read alongside a probe — semantics (`effect-v4-source-lookup`
owns the evidence ladder). It is also the **style oracle**: before building
anything module-shaped, read how core writes the analogous module.

**Stability split.** Modules outside `unstable/` follow strict semver. The
`effect/unstable/*` namespaces may break in minor releases and graduate to
top level as they stabilize.

## Core modules

| Module | What it is | When to reach for it |
| --- | --- | --- |
| `Array` | helpers over JS arrays, readonly and non-empty arrays (map/sort/group/split/reduce) | transforming, grouping, or combining array-shaped collections immutably |
| `BigDecimal` | arbitrary-precision decimal (bigint digits + scale) with arithmetic and formatting | exact decimal math for money/quantities where `number` rounding fails |
| `BigInt` | helpers over native `bigint`: arithmetic, comparison, safe parsing to `Option` | working with `bigint` values and needing safe parse/aggregate/order |
| `Boolean` | helpers over `boolean`: logical ops, lazy branching, ordering, reducing | combining booleans or choosing between lazy branches |
| `Brand` | compile-time nominal tags on structurally-identical values, optionally validating | keeping `Positive`/`UserId`-style values from mixing without runtime cost |
| `Cache` | concurrent cache of Effect lookup results with capacity/TTL and in-flight sharing | memoizing an effectful lookup by key with dedupe/expiry |
| `Cause` | full structured failure record: typed errors, defects, interruptions, annotations | inspecting or formatting why an Effect failed without collapsing it |
| `Channel` | low-level bidirectional streaming primitive underlying Stream and Sink | implementing custom stream operators; app code uses Stream/Sink instead |
| `ChannelSchema` | schema encode/decode adapters wrapping a Channel's typed boundaries | crossing a channel boundary with schema-typed input/output |
| `Chunk` | immutable ordered collection optimized for append/prepend/concat | building/transforming sequences without mutating the original |
| `Clock` | service for reading current time (ms/nanos) and sleeping | time/sleep access you want to fake in tests via a service |
| `Combiner` | strategy interface `combine(a,b)` for merging two same-type values (no identity) | passing a reusable merge rule; use `Reducer` if you need an empty value |
| `Config` | declarative descriptions of config values decoded from a ConfigProvider | reading/validating typed configuration keys with defaults and fallbacks |
| `ConfigProvider` | data sources (env, objects, .env, dirs) that feed raw values to Config | supplying or composing where `Config` reads its raw values from |
| `Console` | Effect wrapper over console (log/group/count/table/timer) as a swappable service | logging/console side effects you want swappable in tests |
| `Context` | typed map of service implementations keyed by Service/Reference | building or reading the service environment `R` of effects |
| `Cron` | recurring calendar schedule from cron expressions or field constraints | matching dates or computing next/previous scheduled occurrences |
| `Crypto` | platform-independent crypto service contract (random bytes, UUID, SHA digests) | secure random/UUID/hashing; contract, platform layer provides implementation |
| `Data` | constructors for immutable value classes, tagged classes/unions, typed errors | defining `_tag`-carrying domain values and errors with structural equality |
| `DateTime` | absolute instants plus optional time-zone-aware date-times and arithmetic | zone-aware timestamps, date math, and formatting |
| `Deferred` | one-time set-once async variable many fibers can await | cross-fiber coordination on a single result/signal |
| `Differ` | interface to compute/combine/apply patches describing value changes | modeling incremental patch-based updates to a value |
| `Duration` | immutable time span (finite or infinite) for delays/timeouts/TTL | expressing delays, timeouts, intervals, or TTLs |
| `Effect` | core `Effect<A,E,R>` type and the main API for building/running workflows | creating, composing, recovering, or running effectful programs |
| `Effectable` | internal: prototype builder + base class to make custom values act as Effects | rarely — making a domain value yieldable in `Effect.gen` |
| `Encoding` | Base64/Base64Url/hex encode/decode between strings, UTF-8, and bytes | converting to/from Base64/hex with `Result`-typed decode errors |
| `Equal` | structural equality (`equals`) plus the Equal interface, guards, adapters | comparing values structurally or implementing custom equality |
| `Equivalence` | reusable `Equivalence<A>` equality predicates and combinators | defining/combining custom same-type equality for a purpose |
| `ErrorReporter` | forwards non-interruption `Cause`s to a callback for logging/monitoring | routing Effect failures to external error-tracking systems |
| `ExecutionPlan` | ordered fallback steps (context/layer + retries) tried until success | declaring fallback providers/retry tiers for effects or streams |
| `Exit` | `Exit<A,E>` value form of a finished Effect (success or `Cause` failure) | inspecting/matching a completed Effect result synchronously as data |
| `Fiber` | handle to a forked effect: await/join/interrupt, current fiber access | managing forked concurrent work and its lifecycle |
| `FiberHandle` | scope-bound holder of at most one fiber, replacing/interrupting prior | tracking a single swappable background fiber tied to a scope |
| `FiberMap` | scope-bound map of fibers keyed by K, auto-removed on completion | managing keyed background fibers under one scope |
| `FiberSet` | scope-bound set of many fibers, all interrupted when scope closes | managing a dynamic group of background fibers under one scope |
| `FileSystem` | portable file system service (read/write/stream/glob/watch), fails `PlatformError` | file IO; contract, platform layer provides implementation |
| `Filter` | composable check returning `Result` (pass/fail) that can also narrow/transform | selective matching/recovery where a predicate must also refine or transform |
| `Formatter` | renders arbitrary JS values to readable strings with redaction/cycle handling | formatting values for logs, diagnostics, or error messages |
| `Function` | core composition helpers: `pipe`, `flow`, `dual`, identity/const/memoize | composing functions or writing dual direct/pipe APIs |
| `Graph` | immutable/scoped-mutable indexed node+edge graph with traversal, paths, export | building/traversing a graph, shortest path, DAG, diagram export |
| `Hash` | computes non-cryptographic structural hashes; interface for custom hash | implementing custom hashing for Equal-based collections |
| `HashMap` | immutable key/value map (HAMT) keyed by structural equality | need immutable map with object/structural keys |
| `HashRing` | weighted consistent-hashing ring keyed by `PrimaryKey` | routing keys/shards to nodes with minimal remapping |
| `HashSet` | immutable set of unique values by Equal/Hash | need immutable set with structural-equality membership |
| `HKT` | type-level: `TypeLambda`/`Kind` higher-kinded encoding | only when authoring generic type classes; agents skip |
| `Inspectable` | internal: log/inspect formatting protocol for Effect values | implementing custom log/console/JSON rendering; rarely needed |
| `Iterable` | lazy combinators over any `[Symbol.iterator]` value | transform/search/group iterables without materializing arrays |
| `JsonPatch` | computes/applies deterministic RFC6902 add/remove/replace patches | diffing two JSON docs or replaying JSON changes |
| `JsonPointer` | RFC6901 token escape/unescape helpers | escaping `~`/`/` in JSON Pointer path segments |
| `JsonSchema` | normalize/convert JSON Schema & OpenAPI dialect documents | converting between Draft-07/2020-12/OpenAPI schemas, `$ref` resolution |
| `Latch` | reusable open/closed fiber coordination primitive | gating fibers until an explicit open/release signal |
| `Layer` | describes acquiring/wiring services with deps and errors | constructing and composing service dependencies |
| `LayerMap` | keyed cache of scoped layer-built service contexts | per-tenant/per-region resource families built on demand |
| `LayerRef` | refreshable single layer-built context with invalidation | share one scoped layer resource, rebuild on invalidate |
| `Logger` | loggers, formatters, console/file routing, install layers | configuring/customizing how log events are emitted |
| `LogLevel` | log-level types, ordering, threshold/enabled helpers | comparing or checking log severities |
| `ManagedRuntime` | runs many effects against services built once from a Layer | bridging Effect to promise/callback/sync entry points |
| `Match` | ordered pattern matcher (`Match.type`/`Match.value`) | pattern-matching on tags, shapes, predicates, literals |
| `MutableHashMap` | in-place map mixing native and Equal/Hash keys | fast mutable map needing structural-key lookup |
| `MutableHashSet` | in-place unique set built on MutableHashMap | fast mutable set with structural-equality members |
| `MutableList` | in-place ordered list; append/prepend, drain from front | buffering values and draining FIFO in place |
| `MutableRef` | synchronous in-place single-value reference | non-effectful mutable cell (vs `Ref`) |
| `Newtype` | compile-time-only branded wrappers over a carrier type | distinguishing same-shape values (e.g. two string ids) |
| `NonEmptyIterable` | type-level: `Iterable` branded as having ≥1 element | typing guaranteed-non-empty iterables; rarely imported directly |
| `Number` | helpers over `number`: parse, math, compare, clamp, aggregate | numeric parsing, safe division, ordering, range checks |
| `Optic` | lens/prism/optional focus for immutable read/update | reading/updating nested immutable structures without mutation |
| `Option` | present/absent value `Some`/`None`, plus `Option.gen` | modeling optional values instead of null/undefined |
| `Order` | comparison functions for ordered values | sorting, min/max, ranges, ordered structures |
| `Ordering` | the `-1/0/1` comparison result plus combinators | working with the output of an `Order` comparison |
| `PartitionedSemaphore` | concurrency limiter over shared permits grouped by key | fair bounded concurrency across independent key groups |
| `Path` | path ops service (join/normalize/parse/resolve); POSIX `Path.layer` built in | path manipulation; contract, platform layer provides (POSIX layer in core) |
| `Pipeable` | internal: `.pipe(...)` method-chaining interface | only when authoring a pipeable data type; agents skip |
| `PlatformError` | normalized platform error model (`BadArgument`/`SystemError` reasons) | typing/handling FileSystem/Terminal/subprocess/host IO failures |
| `Pool` | shares scoped resources borrowed across fibers | pooling connections/clients with TTL and invalidation |
| `Predicate` | runtime guards and refinements with combinators | type guards, tag/shape checks, composing predicates — never hand-write `isRecord`/`isString` |
| `PrimaryKey` | protocol exposing a stable string identifier | giving a value a stable string key (requests, ring nodes) |
| `PubSub` | broadcast hub; each subscriber gets every message | fan-out messaging where subscribers don't compete |
| `Pull` | internal: one low-level stream pull step (value/error/done) | only when writing custom Stream/Channel internals; agents skip |
| `Queue` | async fiber-to-fiber queue; one consumer per value | backpressured/bounded work handoff between fibers |
| `Random` | pseudo-random generator exposed as a replaceable Effect service | need effectful/seeded random numbers, shuffles, or deterministic test randomness |
| `RcMap` | reference-counted map of scoped resources keyed, released when idle/unused | sharing per-key clients/connections/sessions with lifecycle, not general caching |
| `RcRef` | reference-counted handle sharing one scoped resource across borrowers | share a single lazily-acquired resource; finalize when last borrower leaves |
| `Record` | immutable helpers over plain string/symbol-keyed object dictionaries | working with `{}` dictionaries functionally: map/filter/merge/lookup without mutation |
| `Redactable` | protocol for context-aware alternate representations of sensitive objects | building a type that masks itself in logs/traces/serialization |
| `Redacted` | wrapper hiding a value in string/JSON/inspect output while retaining it | carry secrets/tokens through code without leaking them in diagnostics |
| `Reducer` | `Combiner` plus an initial value and fold-an-iterable operation | fold many values into one with an identity/empty case |
| `Ref` | fiber-safe mutable cell with effectful get/set/update/modify | hold shared mutable state that composes with Effect concurrency |
| `References` | built-in `Context.Reference` runtime keys (concurrency, logging, tracing) | read or override runtime execution/diagnostic settings for an effect |
| `RegExp` | native `RegExp` constructor, guard, and literal-escaping helper | build patterns from data-driven text or narrow `unknown` to RegExp |
| `Request` | typed request value describing one data-load with error/requirements | define a batchable/cacheable data query for `Effect.request` |
| `RequestResolver` | resolver that batches, groups, and completes pending `Request` entries | implement backend batching/dedup/caching behind `Effect.request` |
| `Resource` | refreshable scoped value caching last acquisition, auto/manual refresh | cache a scoped value that must refresh on schedule or on demand |
| `Result` | plain `Success`/`Failure` data holding an already-computed outcome | represent a settled success-or-error value without running effects (v4's Either successor) |
| `Runtime` | low-level `makeRunMain` for turning an Effect into a process entry point | writing a platform runner; app code uses platform-provided runners instead |
| `Schedule` | policy stepping inputs into outputs plus delays for retry/repeat/pace | decide when/how often to retry, repeat, or pace an effect |
| `Scheduler` | controls how runnable fiber tasks are queued, dispatched, and yielded | internal/advanced: tune or disable fiber scheduling and yields — usually skip |
| `Schema` | validate/decode/encode data shapes with codecs, classes, refinements | the primary entry point for any schema, codec, or data validation |
| `SchemaAST` | runtime tree representation of schemas (nodes, checks, annotations) | advanced machinery: inspect/build/rewrite schema ASTs programmatically |
| `SchemaGetter` | one-way optional-in/optional-out conversions used inside transformations | consumer-facing when authoring a custom decode/encode direction |
| `SchemaIssue` | describes and formats decode/encode/check failures with location | consumer-facing: inspect or format schema validation errors |
| `SchemaParser` | runs a schema against values (decode/encode/validate) in many result styles | consumer-facing: execute a schema returning Effect/Exit/Option/Result/sync |
| `SchemaRepresentation` | JSON-serializable descriptions of schemas plus TS-codegen | machinery: serialize schemas, convert to/from JSON Schema, generate code |
| `SchemaTransformation` | two-way encode/decode conversions connecting two representations | consumer-facing when building a custom bidirectional codec |
| `SchemaUtils` | specialized schema helpers too niche for core `Schema` | internal/advanced — usually skip |
| `Scope` | lifetime boundary collecting finalizers run with an `Exit` on close | directly create/fork/close scopes; most code uses `Effect.scoped`/`Layer` |
| `ScopedCache` | cache whose entries own scopes, releasing resources on eviction | cache resource-backed values with per-entry cleanup and expiry |
| `ScopedRef` | current value plus the scope owning it; swaps acquire/release atomically | hold a swappable resource handle (client/connection) with clean replacement |
| `Semaphore` | permit pool limiting concurrent access to a shared resource | bound concurrency around an effect via acquire/release of permits |
| `Sink` | stream consumer folding/collecting a `Stream`'s output into one result | terminating a Stream: collect, fold, count, or search its elements |
| `Stdio` | argv and stdin/stdout/stderr of the CURRENT process as an Effect service | standard-IO access (not spawning); contract, platform layer provides |
| `Stream` | effectful source emitting many values over time with error/requirements | model pull-based/streaming data: queues, callbacks, files, paginated sources |
| `String` | pipe-friendly helpers over TypeScript `string` values | functional string ops: trim/case/slice/replace/Option-returning search |
| `Struct` | immutable helpers over plain TypeScript objects (pick/omit/rename) | transform object shapes functionally and derive comparisons |
| `SubscriptionRef` | `Ref` that publishes every committed change as a `changes` stream | hold state others must observe reactively over time |
| `Symbol` | runtime predicate narrowing `unknown` to a primitive `symbol` | guarding an `unknown` before using it as a symbol key/discriminant |
| `SynchronizedRef` | `Ref` whose updates run one-at-a-time, safe for effectful transitions | serialize state updates when the next value is computed by an effect |
| `Take` | stored representation of one stream pull: batch, failure, or done | low-level stream plumbing: inspecting buffered pull results |
| `Terminal` | interactive terminal service (size, line/key input, output) | terminal capabilities; contract, platform layer provides |
| `Tracer` | low-level span/tracing model and tracer service | define/inspect spans or a custom tracer; usually via higher-level tracing APIs |
| `Trie` | immutable string-keyed prefix tree for prefix/longest-match lookup | autocomplete, route tables, dictionaries, prefix-based key lookup |
| `Tuple` | immutable helpers over fixed-length arrays preserving element positions | build/transform positional tuples and derive tuple comparisons |
| `TxChunk` | transactional `Chunk` stored in a `TxRef` | STM-family: atomic sequence/buffer updates within a transaction |
| `TxDeferred` | write-once transactional cell completing to a `Result`, retrying readers | STM-family: coordinate/await a one-shot value across transactions |
| `TxHashMap` | transactional `HashMap` in a `TxRef` | STM-family: atomic keyed registry/counter/index updates |
| `TxHashSet` | transactional `HashSet` in a `TxRef` | STM-family: atomic set membership changes alongside other state |
| `TxPriorityQueue` | transactional priority queue ordered by an `Order`, retrying take/peek | STM-family: ordered coordination queue with transactional waiting |
| `TxPubSub` | transactional publish/subscribe hub over `TxQueue` subscribers | STM-family: broadcast values atomically within transactions |
| `TxQueue` | transactional queue with enqueue/dequeue handles, retrying when blocked | STM-family: coordinate producers/consumers within transactions |
| `TxReentrantLock` | transactional reentrant read/write lock tracked by fiber | STM-family: shared/exclusive locking that composes in transactions |
| `TxRef` | core transactional reference journaled and committed via `Effect.tx` | STM-family: the base transactional cell all Tx collections build on |
| `TxSemaphore` | transactional fixed-capacity permit pool in a `TxRef` | STM-family: permit acquisition that commits with other transactional state |
| `TxSubscriptionRef` | transactional `Ref` publishing committed changes to subscribers | STM-family: observable transactional state with current-value replay |
| `Types` | compile-time-only utility types (tuples, unions, variance, mutability) | type-level plumbing — no runtime; agents skip unless authoring types |
| `UndefinedOr` | helpers for plain `A \| undefined` values | handle optionality with `undefined` without wrapping in `Option` |
| `Unify` | type-level unification protocol collapsing unions to public data types | maintainer/advanced type plumbing — skip |
| `Utils` | internal generator machinery behind `Effect.gen`/HKT | internal — skip |
| `testing/FastCheck` | re-export of `fast-check` for property-based testing | generate random inputs for property tests alongside Effect helpers |
| `testing/TestClock` | controllable `Clock` service driving virtual time | make sleep/timeout/schedule/retry tests deterministic by advancing time |
| `testing/TestConsole` | test `Console` capturing log/error calls in memory | assert on console output deterministically in tests |
| `testing/TestSchema` | assertions for schema construct/decode/encode/arbitrary/round-trip | testing that a schema decodes, encodes, and round-trips correctly |

## The unstable namespaces (`effect/unstable/<ns>`)

Breaking changes allowed in minors; graduate to top level as they stabilize.
Full consolidation background: `effect-v4-construct-map`'s consolidated-core
section.

| Namespace | What it is | When to reach for it |
| --- | --- | --- |
| `ai` | provider-neutral AI: `LanguageModel`, `Chat`, `Tool`/`Toolkit`, MCP schema/server | building AI features against a provider-agnostic surface (`@effect/ai-*` provides) |
| `cli` | the v4 CLI framework: `Command`, `Flag`, `Argument`, `Prompt`, completions | building a command-line tool — see `effect-v4-cli` |
| `cluster` | entity sharding runtime: `Sharding`, `Entity`, runners, message storage | distributing stateful entities across machines |
| `devtools` | client/server wiring an Effect runtime to the devtools tracer | connecting a program to Effect devtools |
| `encoding` | channel codecs: `Msgpack`, `Ndjson`, `Sse` | framing streams as NDJSON/MsgPack/server-sent events |
| `eventlog` | typed, replicated (optionally encrypted) event journal with SQL backends | event-sourced state that syncs/replicates |
| `http` | HTTP client + server: `HttpClient`, `FetchHttpClient`, router, middleware | any HTTP work — clients (see runtimes precedent) or servers |
| `httpapi` | schema-first declarative HTTP APIs with OpenAPI/Swagger output | defining a typed HTTP API contract shared by server and client |
| `jsonschema` | JSON Schema derivation/interop for the schema system | emitting JSON Schema from schemas |
| `observability` | OTLP + Prometheus exporters for traces/metrics/logs | exporting telemetry without the `@effect/opentelemetry` SDK |
| `persistence` | `KeyValueStore` (memory/fs/SQL), `PersistedCache`/`PersistedQueue`, `RateLimiter` | durable KV, request-level durable caching, rate limiting |
| `process` | `ChildProcess` Command values + `ChildProcessSpawner` service | spawning subprocesses (`@effected/git` is the house example; require in `R`) |
| `reactivity` | atom-based reactive state (`Atom`, `AtomRegistry`, hydration) | framework-facing reactive state (`@effect/atom-*` binds it) |
| `rpc` | schema-backed RPC: groups, client/server, serialization, worker transport | typed request/response between processes without hand-rolling HTTP |
| `schema` | `Model` (DB-vs-JSON variant models) + `VariantSchema` | one model with per-context variants (insert/update/json) |
| `socket` | `Socket` + `SocketServer` contracts | raw bidirectional connections |
| `sql` | the SQL core: `SqlClient`, `Statement`, `Migrator`, models/resolvers | any SQL — drivers live in `@effect/sql-*` (`@effected/store` is the house example) |
| `workflow` | durable workflows: `Workflow`, `Activity`, durable clock/deferred/queue | long-running resumable multi-step operations (application tier — see roadmap note) |
| `workers` | `Worker`/`WorkerRunner`/`Transferable` for worker threads | offloading work to browser/Node/Bun workers |

## Sharp corners the index surfaced (not covered elsewhere)

- `Queue` is `Queue<A, E>` in v4 — it carries an error channel and can
  `fail`/`done`, not just hold values.
- `Optic` moved INTO core (was `@effect/optic`) and is Schema-aware.
- The `Tx*` family is v3's STM reorganized: `TxRef` + `Effect.tx` replace
  `STM`/`TRef`/`TMap`/`TQueue` as per-collection core modules.
- Runtime knobs (concurrency, logging, tracing settings) live in `References`
  as `Context.Reference` keys; scheduling internals in `Scheduler`.
- `UndefinedOr` exists for `A | undefined` ergonomics — not every optional
  needs `Option`.
- Testing utilities live in core under `effect/testing/*` — no separate
  test-support package.

## How the skills divide the territory

This index routes. For patterns: `effect-v4-idioms` (errors, resources,
fibers), `effect-v4-schema` (everything Schema), `effect-v4-services-layers`
(Context/Layer discipline), `effect-v4-testing` (the test idioms),
`effect-v4-observability` (spans/logs/metrics), `effect-v4-cli` (unstable/cli),
`effect-v4-construct-map` (v3→v4 renames + the consolidated core),
`effect-v4-source-lookup` (how to verify any row here against the source).
