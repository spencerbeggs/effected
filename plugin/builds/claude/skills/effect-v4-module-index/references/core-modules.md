# Core modules

Every top-level module of `effect@4` core, one row each: what it is and when to
reach for it. Source is `src/<Name>.ts`, testing modules under `src/testing/`.
A row says what exists, not its exact shape: verify the signature in the
installed source before you write the call (the `SKILL.md`'s "Look it up
first" steps).

| Module | What it is | When to reach for it |
| --- | --- | --- |
| `Array` | helpers over JS arrays, readonly and non-empty arrays (map/sort/group/split/reduce) | transforming, grouping, or combining array-shaped collections immutably |
| `BigDecimal` | arbitrary-precision decimal (bigint digits + scale) with arithmetic and formatting | exact decimal math for money/quantities where `number` rounding fails |
| `BigInt` | helpers over native `bigint`: arithmetic, comparison, safe parsing to `Option` | working with `bigint` values and needing safe parse/aggregate/order |
| `Boolean` | helpers over `boolean`: logical ops, lazy branching, ordering, reducing | combining booleans or choosing between lazy branches |
| `Brand` | compile-time nominal tags on structurally-identical values, optionally validating | keeping `Positive`/`UserId`-style values from mixing without runtime cost |
| `ByteSize` | a branded non-negative `bigint` byte count (`ByteSize.ts:32`) with unit constructors (`bytes`, `kilobytes`/`kibibytes` … `quettabytes`), `fromInput`/`fromInputUnsafe` over `ByteSize.Input = ByteSize \| bigint \| number \| string`, `toBigInt`/`toNumber` (Option)/`toNumberUnsafe`, `sum`/`subtract`/`times`/`divide`, `Order`/`Equivalence`/`between`/`clamp`, `format` | any byte quantity — it **replaces `FileSystem.Size`/`SizeInput`**, which do not exist: `File.Info.size` and `blksize` are `ByteSize` (`FileSystem.ts:1103-1104`), `FileSystem.stream`'s `bytesToRead`/`offset` are `ByteSize.Input` (`:378-380`), `File.seek` takes a `bigint` and returns one (`:958`), `read`/`write` return `number` (`:964`, `:975`), `readAlloc`/`truncate` take `number` (`:970-974`). Reach for `ByteSize.toNumberUnsafe(info.size)` at a `Buffer` boundary, never `Number(info.size)` spelled by hand |
| `Bytes` | helpers over `Uint8Array`: `concat`, `Equivalence`, `Order` | joining or comparing byte arrays without a `Buffer` dependency |
| `Cache` | concurrent cache of Effect lookup results with capacity/TTL and in-flight sharing (`make` = fixed TTL, `makeWith` = per-entry TTL from the `Exit`) | memoizing an effectful lookup by key with dedupe/expiry — this is the whole feature; do not hand-roll an in-flight promise map |
| `Cause` | full structured failure record: typed errors, defects, interruptions, annotations | inspecting or formatting why an Effect failed without collapsing it |
| `Channel` | low-level bidirectional streaming primitive underlying Stream and Sink | implementing custom stream operators; app code uses Stream/Sink instead |
| `ChannelSchema` | schema encode/decode adapters wrapping a Channel's typed boundaries | crossing a channel boundary with schema-typed input/output |
| `Chunk` | immutable ordered collection optimized for append/prepend/concat | building/transforming sequences without mutating the original |
| `Codegen` | `experimental` TypeScript module builder: `new Codegen.Module()`, `addSchemas` (exported type aliases and runtime schemas from `SchemaRepresentation` documents, collision-free names), `declare`/`define`, the `code` tagged template, `print` | generating TypeScript source from schemas or by hand — there is no `SchemaRepresentation.toCodeDocument`; see `effect-v4-schema` |
| `Clock` | service for reading current time (ms/nanos) and sleeping | time/sleep access you want to fake in tests via a service |
| `Combiner` | strategy interface `combine(a,b)` for merging two same-type values (no identity) | passing a reusable merge rule; use `Reducer` if you need an empty value |
| `Config` | declarative descriptions of config values decoded from a ConfigProvider | reading/validating typed configuration keys with defaults and fallbacks |
| `ConfigProvider` | data sources (env, objects, .env, dirs) that feed raw values to Config | supplying or composing where `Config` reads its raw values from |
| `Console` | Effect wrapper over console (log/group/count/table/timer) as a swappable service | logging/console side effects you want swappable in tests |
| `Context` | typed map of service implementations keyed by Service/Reference | building or reading the service environment `R` of effects |
| `Cron` | recurring calendar schedule from cron expressions or field constraints | matching dates or computing next/previous scheduled occurrences |
| `Data` | constructors for immutable value classes, tagged classes/unions, typed errors | defining `_tag`-carrying domain values and errors with structural equality |
| `DateTime` | absolute instants plus optional time-zone-aware date-times and arithmetic | zone-aware timestamps, date math, and formatting |
| `Deferred` | one-time set-once async variable many fibers can await | cross-fiber coordination on a single result/signal |
| `Differ` | interface to compute/combine/apply patches describing value changes | modeling incremental patch-based updates to a value |
| `Duration` | immutable time span (finite or infinite) for delays/timeouts/TTL; ISO 8601 via `formatIso` (`Option<string>`, `none` for infinite) and `fromIso` (`Option<Duration>`) | expressing delays, timeouts, intervals, or TTLs; `Schema.DurationFromIsoString` is the schema form of the ISO codec |
| `Effect` | core `Effect<A,E,R>` type and the main API for building/running workflows | creating, composing, recovering, or running effectful programs |
| `Effectable` | internal: prototype builder + base class to make custom values act as Effects | rarely — making a domain value yieldable in `Effect.gen` |
| `Equal` | structural equality (`equals`) plus the Equal interface, guards, adapters | comparing values structurally or implementing custom equality |
| `Equivalence` | reusable `Equivalence<A>` equality predicates and combinators | defining/combining custom same-type equality for a purpose |
| `ErrorReporter` | forwards non-interruption `Cause`s to a callback for logging/monitoring | routing Effect failures to external error-tracking systems |
| `ExecutionPlan` | ordered fallback steps (context/layer + retries) tried until success | declaring fallback providers/retry tiers for effects or streams |
| `Exit` | `Exit<A,E>` value form of a finished Effect (success or `Cause` failure) | inspecting/matching a completed Effect result synchronously as data |
| `Fiber` | handle to a forked effect: await/join/interrupt, current fiber access | managing forked concurrent work and its lifecycle |
| `FiberHandle` | scope-bound holder of at most one fiber, replacing/interrupting prior | tracking a single swappable background fiber tied to a scope |
| `FiberMap` | scope-bound map of fibers keyed by K, auto-removed on completion | managing keyed background fibers under one scope |
| `FiberSet` | scope-bound set of many fibers, all interrupted when scope closes | managing a dynamic group of background fibers under one scope |
| `FileSystem` | portable file system service (read/write/stream/glob/watch), fails `PlatformError`; sizes are `ByteSize` (see that row), and `File.seek` before the start of the file fails `BadArgument` and leaves the cursor unchanged (`FileSystem.ts:956-958`; the Node implementation is `@effect/platform-node-shared`; `effect-v4-source-lookup` says where to read its source). `glob` is core's own walk on every platform: wildcard segments match **case-sensitively** even on a case-insensitive volume, while leading literal segments use `stat` and keep the pattern's spelling (`FileSystem.ts:154-156`); patterns use `/` separators | file IO; contract, platform layer provides implementation. **A custom implementation** must supply `readDirectoryEntries` (each entry's `name` and `type`, `"Unknown"` allowed). `FileSystem.make(impl)` derives `glob` (with `exists`, `readFileString`, `stream`, `sink`, `writeFileString`) and accepts none of them; apply a custom `glob` afterwards with `FileSystem.FileSystem.of({ ...FileSystem.make(impl), glob })`. A wrapper that changes `readDirectory` must change `readDirectoryEntries` the same way |
| `Filter` | composable check returning `Result` (pass/fail) that can also narrow/transform | selective matching/recovery where a predicate must also refine or transform |
| `Formatter` | renders arbitrary JS values to readable strings with redaction/cycle handling | formatting values for logs, diagnostics, or error messages |
| `Function` | core composition helpers: `pipe`, `flow`, `dual`, identity/const/memoize | composing functions or writing dual direct/pipe APIs |
| `Glob` | `experimental` pure matcher over `/`-separated paths with `FileSystem.glob`'s pattern syntax: `make(pattern, { dot? })`, `match` (dual), `escape` | testing a path against a glob with no file-system access; use `FileSystem.glob` to walk a tree |
| `Graph` | immutable indexed node+edge graph carrying user data on both, mutated only inside a scoped window (`mutate(g, draft => …)`, or `beginMutation`/`endMutation`); directed-vs-undirected is a `Kind` type parameter. 95 exports — `dfs`/`bfs`/`topo`/`externals` walkers, the named algorithms (`dijkstra`, `bellmanFord`, `floydWarshall`, `astar`, `isAcyclic`, `isBipartite`, `connectedComponents`, `stronglyConnectedComponents`), graph set algebra (`compose`, `intersection`, `difference`, `symmetricDifference`, `complement`, `sum`), and `toMermaid` / `toGraphViz` emitters returning a diagram `string` | any graph problem — **do not hand-roll shortest path, topological sort, cycle detection, or SCCs beside it.** `Kind` gates the algorithms at the type level: `topo`/`stronglyConnectedComponents` take `"directed"` only, `isBipartite`/`connectedComponents` `"undirected"` only, so pick the constructor for the analysis you need (`stronglyConnectedComponents` also throws `GraphError` on an undirected graph at runtime). Reach for `toMermaid` whenever you want a diagram of anything you can model as nodes and edges |
| `Hash` | computes non-cryptographic structural hashes; interface for custom hash | implementing custom hashing for Equal-based collections |
| `HashMap` | immutable key/value map (HAMT) keyed by structural equality | need immutable map with object/structural keys |
| `HashRing` | weighted consistent-hashing ring keyed by `PrimaryKey` | routing keys/shards to nodes with minimal remapping |
| `HashSet` | immutable set of unique values by Equal/Hash | need immutable set with structural-equality membership |
| `HKT` | type-level: `TypeLambda`/`Kind` higher-kinded encoding | only when authoring generic type classes; agents skip |
| `Inspectable` | internal: log/inspect formatting protocol for Effect values | implementing custom log/console/JSON rendering; rarely needed |
| `Iterable` | lazy combinators over any `[Symbol.iterator]` value | transform/search/group iterables without materializing arrays |
| `JsonPatch` | computes/applies deterministic RFC6902 add/remove/replace patches | diffing two JSON docs or replaying JSON changes |
| `JsonPointer` | RFC6901 token escape/unescape helpers | escaping `~`/`/` in JSON Pointer path segments |
| `JsonSchema` | normalize/convert JSON Schema & OpenAPI dialect documents | converting between Draft-07/2020-12/OpenAPI schemas, `$ref` resolution. **Generation lives in `Schema`**: `Schema.toJsonSchemaDocument` (2020-12; `includeAnnotationKey` admits custom keys) then `JsonSchema.toDocumentDraft07` to lower. **The lowering carries unknown and custom keywords through as opaque values**, in place — so an annotation admitted at 2020-12 reaches draft-07 unchanged, and there is nothing to re-graft — the failure to guard against is publishing a key you assumed could not escape. The `$defs` pool maps key-for-key, and annotations move with their node across the coordinate moves (`prefixItems[i]`→`items[i]`, trailing `items`→`additionalItems`). Filtering is the caller's job, upstream of the lowering. |
| `Latch` | reusable open/closed fiber coordination primitive | gating fibers until an explicit open/release signal |
| `Layer` | describes acquiring/wiring services with deps and errors | constructing and composing service dependencies |
| `LayerMap` | keyed cache of scoped layer-built service contexts | per-tenant/per-region resource families built on demand |
| `LayerRef` | refreshable single layer-built context with invalidation | share one scoped layer resource, rebuild on invalidate |
| `Logger` | loggers, formatters, console/file routing, install layers | configuring/customizing how log events are emitted |
| `LogLevel` | log-level types, ordering, threshold/enabled helpers | comparing or checking log severities |
| `ManagedRuntime` | runs many effects against services built once from a Layer | bridging Effect to promise/callback/sync entry points |
| `Match` | ordered pattern matcher (`Match.type`/`Match.value`); `Match.literals({ ... })` handles a subset of literal values by key, `literalsExhaustive` all of them | pattern-matching on tags, shapes, predicates, literals |
| `Metric` | counters/gauges/histograms/frequencies/summaries/timers, attached to effects via `Effect.track` | metering an operation — boundaries only; see `effect-v4-observability`. NB there is no `Metric.tagged`/`taggedWithLabels`; attributes are `Metric.withAttributes` |
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
| `Pool` | shares scoped resources borrowed across fibers; `Pool.stats` snapshots `{ idle, used, pending, min, max }` | pooling connections/clients with TTL and invalidation; `stats` for occupancy metrics (`idle + used` can briefly exceed `max` while an invalidated item is replaced) |
| `Predicate` | runtime guards and refinements with combinators | type guards, tag/shape checks, composing predicates — never hand-write `isString`/object guards (NB: no `isRecord` on the v4 line; the record-ish guards are `isObject`/`isReadonlyObject`/`isObjectOrArray`) |
| `PrimaryKey` | protocol exposing a stable string identifier | giving a value a stable string key (requests, ring nodes) |
| `PubSub` | broadcast hub; each subscriber gets every message | fan-out messaging where subscribers don't compete |
| `Pull` | internal: one low-level stream pull step (value/error/done) | only when writing custom Stream/Channel internals; agents skip |
| `Queue` | async fiber-to-fiber queue; one consumer per value | backpressured/bounded work handoff between fibers |
| `Random` | pseudo-random generator exposed as a replaceable Effect service | need effectful/seeded random numbers, shuffles, or deterministic test randomness |
| `Rational` | exact fractions over `bigint` numerator and denominator (`makeUnsafe`, `fromBigInt`, arithmetic, `equals`, `toBigDecimal(r, { scale })`), with `Schema.Rational` and `Schema.RationalFromString` | exact ratios such as one third, where `BigDecimal` would have to round; convert to `BigDecimal` at a display or storage edge |
| `RcMap` | reference-counted map of scoped resources keyed, released when idle/unused | sharing per-key clients/connections/sessions with lifecycle, not general caching |
| `RcRef` | reference-counted handle sharing one scoped resource across borrowers | share a single lazily-acquired resource; finalize when last borrower leaves |
| `Record` | immutable helpers over plain string/symbol-keyed object dictionaries | working with `{}` dictionaries functionally: map/filter/merge/lookup without mutation |
| `Redactable` | protocol for context-aware alternate representations of sensitive objects | building a type that masks itself in logs/traces/serialization |
| `Redacted` | wrapper hiding a value in string/JSON/inspect output while retaining it | carry secrets/tokens through code without leaking them in diagnostics |
| `Reducer` | `Combiner` plus an initial value and fold-an-iterable operation | fold many values into one with an identity/empty case |
| `Ref` | fiber-safe mutable cell with effectful get/set/update/modify | hold shared mutable state that composes with Effect concurrency |
| `References` | built-in `Context.Reference` runtime keys — logging, tracing, stack frames, loggers | read or override runtime diagnostic settings for an effect. **No concurrency key exists** despite the module's own header prose claiming one — concurrency is a per-call `{ concurrency }` option |
| `RegExp` | native `RegExp` constructor, guard, and literal-escaping helper | build patterns from data-driven text or narrow `unknown` to RegExp |
| `Request` | typed request value describing one data-load with error/requirements | define a batchable/cacheable data query for `Effect.request` |
| `RequestResolver` | resolver that batches, groups, and completes pending `Request` entries | implement backend batching/dedup/caching behind `Effect.request` |
| `Resource` | refreshable scoped value caching last acquisition, auto/manual refresh | cache a scoped value that must refresh on schedule or on demand |
| `Result` | plain `Success`/`Failure` data holding an already-computed outcome | represent a settled success-or-error value without running effects (v4's Either successor) |
| `Runtime` | low-level `makeRunMain` for turning an Effect into a process entry point, the `Teardown` that maps an `Exit` to an exit code (`defaultTeardown`), and `InterruptExitCode`, a service annotated onto an interruption to choose its exit code | writing a platform runner; app code uses platform-provided runners instead. Annotate an interrupt your program raises at a clean end with `Context.make(Runtime.InterruptExitCode, 0)` instead of writing a custom teardown; an unannotated interrupt, such as a signal's, still exits `130` |
| `Schedule` | policy stepping inputs into outputs plus delays for retry/repeat/pace | decide when/how often to retry, repeat, or pace an effect |
| `Scheduler` | controls how runnable fiber tasks are queued, dispatched, and yielded | internal/advanced: tune or disable fiber scheduling and yields — usually skip |
| `Schema` | validate/decode/encode data shapes with codecs, classes, refinements | the primary entry point for any schema, codec, or data validation. Checks include `Schema.isAscii()` (`U+0000`–`U+007F`); codecs include `Schema.DurationFromIsoString` (ISO 8601 string ↔ `Duration`) |
| `SchemaAST` | runtime tree representation of schemas (nodes, checks, annotations) | advanced machinery: inspect/build/rewrite schema ASTs programmatically |
| `Schema.SchemaError` | the error a schema decode/encode fails with: a `SchemaIssue` tree plus a formatted `message`. **Not a module** — it is a class exported from `Schema.ts` (`Schema.ts:1220`), so `import … from "effect/SchemaError"` fails to resolve; there is no `src/SchemaError.ts` and no `./SchemaError` export. Import it as `Schema.SchemaError` | catching/normalizing schema failures at a boundary — `Effect.catchTag("SchemaError", …)`. v4 exposes no `Schema` for the issue tree, so it rides in a domain error as `Schema.Defect()` |
| `SchemaGetter` | one-way optional-in/optional-out conversions used inside transformations | consumer-facing when authoring a custom decode/encode direction |
| `SchemaIssue` | describes and formats decode/encode/check failures with location | consumer-facing: inspect or format schema validation errors |
| `SchemaParser` | runs a schema against values (decode/encode/validate) in many result styles | consumer-facing: execute a schema returning Effect/Exit/Option/Result/sync |
| `SchemaRepresentation` | JSON-serializable descriptions of schemas plus TS-codegen | machinery: serialize schemas, convert to/from JSON Schema, generate code |
| `SchemaTransformation` | two-way encode/decode conversions connecting two representations | consumer-facing when building a custom bidirectional codec |
| `SemVer` | strict Semantic Versioning 2.0.0 values: `parse`/`fromInput`, `format`, comparison (`isGreaterThan`, `between`, `clamp`, `Order`/`Equivalence`), `bump*` (major/minor/patch/pre*), `isPrerelease`, `difference`, plus schemas and string codecs | parsing, comparing or bumping a version string — do not hand-roll a semver regex. Core is enough for a plain compare or bump in code with no kit edge; reach for kit `@effected/semver` when the value crosses a kit API or you need a `FromString` codec, an error carrying `input` and `position`, or a `Result` twin (`parseResult`). Never mix kit and core values in one `HashSet`/`HashMap`: kit equality ignores build metadata |
| `SemVerRange` | npm-style ranges: `parse`, `matches`, `caret`/`tilde`/`exact`/`any`/comparators, `maxSatisfying`/`minSatisfying` | asking whether a version satisfies a range, or picking the best match from a list. Core is enough for a plain match; reach for kit `@effected/semver`'s `Range` for range algebra (`intersect`, `isSubset`, `simplify`), parse errors with a position, or a `Result` twin |
| `Scope` | lifetime boundary collecting finalizers run with an `Exit` on close | directly create/fork/close scopes; most code uses `Effect.scoped`/`Layer` |
| `ScopedCache` | cache whose entries own scopes, releasing resources on eviction | cache resource-backed values with per-entry cleanup and expiry |
| `ScopedRef` | current value plus the scope owning it; swaps acquire/release atomically | hold a swappable resource handle (client/connection) with clean replacement |
| `Semaphore` | permit pool limiting concurrent access to a shared resource | bound concurrency around an effect via acquire/release of permits; `Semaphore.takeScoped(sem, n)` holds permits until the surrounding `Scope` closes |
| `Sink` | stream consumer folding/collecting a `Stream`'s output into one result | terminating a Stream: collect, fold, count, or search its elements |
| `Stdio` | argv and stdin/stdout/stderr of the CURRENT process as an Effect service | standard-IO access (not spawning); contract, platform layer provides — but core ships `Stdio.layerTest(Partial<Stdio>)` for echo-testing without one |
| `Stream` | effectful source emitting many values over time with error/requirements | model pull-based/streaming data: queues, callbacks, files, paginated sources |
| `String` | pipe-friendly helpers over TypeScript `string` values | functional string ops: trim/case/slice/replace/Option-returning search; `isWellFormed`/`toWellFormed` (unstable) to test for or replace unpaired UTF-16 surrogates instead of a lone-surrogate regex |
| `Struct` | immutable helpers over plain TypeScript objects (pick/omit/rename) | transform object shapes functionally and derive comparisons |
| `SubscriptionRef` | `Ref` that publishes every committed change as a `changes` stream | hold state others must observe reactively over time |
| `Symbol` | runtime predicate narrowing `unknown` to a primitive `symbol` | guarding an `unknown` before using it as a symbol key/discriminant |
| `SynchronizedRef` | `Ref` whose updates run one-at-a-time, safe for effectful transitions | serialize state updates when the next value is computed by an effect |
| `Take` | stored representation of one stream pull: batch, failure, or done | low-level stream plumbing: inspecting buffered pull results |
| `Terminal` | interactive terminal service (size, line/key input, output); `size` is a scoped queue that starts with the current `Size` and receives each resize | terminal capabilities; contract, platform layer provides. A hand-built `Terminal.make` must supply `size` beside `columns`, `rows`, `readInput`, `readLine` and `display` |
| `TextDiff` | `experimental` edit scripts over arrays, lines or code points: `diff`/`diffWith`, `apply`/`applyText`, `invert`, `unified` formatting, `hunks` (a line diff grouped into `diff -u` style hunks as data, optionally with the ranges that differ inside changed lines), `maxEdits` to bound search | computing a diff or a unified patch — do not pull in a diff library |
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
| `Version` | the `effect` version string core stamps into telemetry headers, resources and scopes: `getCurrentVersion()` / `setCurrentVersion(v)`. `@stability unstable` | reading or overriding the version an exporter reports — layers already built keep the value they read |
| `testing/TestClock` | controllable `Clock` service driving virtual time | make sleep/timeout/schedule/retry tests deterministic by advancing time |
| `testing/TestConsole` | test `Console` capturing log/error calls in memory. `@stability unstable` | assert on console output deterministically in tests |
| `testing/TestSchema` | assertions for one schema: `new TestSchema.Asserts(schema)` with `make`, `decoding()` / `encoding()` (`succeed`/`fail` as Promises, `succeedEffect`/`failEffect` as lazy Effects), `arbitrary()` and `verifyRoundTrip` / `verifyRoundTripEffect`; the property checks run `Arbitrary.checkEffect`. `@stability unstable` | testing that a schema constructs, decodes, encodes and round-trips correctly. The `Effect`-suffixed forms use the calling fiber's services, so they compose inside `it.effect`. **There is no `testing/FastCheck`** — there is no fast-check bridge; property generation is `Arbitrary` |
