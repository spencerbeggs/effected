---
name: effect-v4-observability
description: Use when adding logging, metrics, tracing/spans, or OpenTelemetry to Effect v4 code — covers Effect.fn named spans, the Effect.log* family, Metric counters/gauges/histograms with Metric.withAttributes (NOT the removed Metric.tagged), and wiring @effect/opentelemetry at the app edge. Encodes the house rule that pure-tier libraries instrument public fallible boundaries only and stay telemetry-agnostic, while apps compose OTel at the infrastructure layer.
---

# Effect v4 observability

Effect-core APIs below are verified against `effect@4.0.0-beta.94+`.
`@effect/opentelemetry` is **not installed** in this monorepo — every
`@effect/opentelemetry` example is *shape per the official guide; verify against
the installed package when first adopted*. v4 betas move fast; when an API is not
listed here, probe it (`typeof`) before writing code. Module routing (what
`Tracer`, `Logger`, `References` are) lives in `effect-v4-module-index`.

## The house rule (this is the whole point)

> Observability is composed **once, at the infrastructure/edge layer**. Domain
> operations stay telemetry-agnostic. Libraries never import
> `@effect/opentelemetry`.

The official Effect observability guide endorses this exactly: "business code
stays observability-agnostic; OpenTelemetry is introduced at the infrastructure
layer, not inside domain operations." Our pure-tier libraries (semver, jsonc,
yaml) are a *specialization* of that guide, not a deviation.

**Our specialization for pure-tier parser/engine libraries:** instrument
**public fallible boundaries only** with named `Effect.fn("Name.op")` spans.
**No per-node / hot-path spans.** No metrics on internal helpers. Apps compose
`@effect/opentelemetry` at their edge and get traces/metrics/logs from the
library for free — because the library only emits named spans at the operations
a user actually calls.

**Coverage is uniform, not selective.** "Boundaries only" is a ceiling (don't go
below the public boundary), not a filter for picking the interesting ones. Every
public fallible method of a service gets a named span — if one is traced, all of
them are. Partial coverage is worse than none: a user tracing their app sees one
method light up but not its equally-public siblings and reasonably concludes
those never ran or cannot fail. The blind spot reads as signal.

## Tracing — `Effect.fn` is the v4 idiom

`Effect.fn`, `Effect.fnUntraced`, `Effect.withSpan`, `Effect.withSpanScoped`,
`Effect.withParentSpan`, `Effect.annotateCurrentSpan`, `Effect.withLogSpan` — all
present as `function` in beta.94.

```ts
import { Effect } from "effect"

// Named span — our default at PUBLIC FALLIBLE boundaries (Yaml.parse, SemVer.compare).
const parse = Effect.fn("Yaml.parse")(function* (input: string) {
  yield* Effect.annotateCurrentSpan({ length: input.length }) // stable IDs / small values ONLY
  return yield* runEngine(input)
})

// Bare Effect.fn (NO name) — the guide's middle ground: keeps stack frames for
// better traces WITHOUT emitting a named span. Use for reusable internal ops
// where you want stack-frame ergonomics but not span identity.
const normalize = Effect.fn(function* (raw: string) {
  return raw.trim()
})

// fnUntraced — measured hot low-level internals ONLY; throws away observability.
const tightHelper = Effect.fnUntraced(function* (x: string) {
  return x
})
```

Draw the line by *purpose*: **named span = tracing identity** (public fallible
boundary only); **bare `Effect.fn` = stack-frame ergonomics** (fine internally);
**`fnUntraced` = hot path, no frames**. "Boundaries only" governs *named* spans —
it does not forbid bare `Effect.fn` inside an engine.

**Pure `Result`-returning siblings of a spanned boundary carry no span.** This
is the kit's **Result-parity rule** — ratified kit-wide policy, not a package
idiosyncrasy (authoritative statement: the effected repo's
`formatter-convention.md`, decision 6). Scope test: a public boundary returning
`Effect` with `R = never`, no async step and no IO — where the wrapper carries
nothing but a span and the error channel — must expose the sync form as the
primitive, spelled `*Result` (`Fmt.parseResult` pure, `Fmt.parse` spanned).
Never `*Sync`: the Effect form is also synchronous, and the kit uses `*Sync`
for genuinely-blocking-IO facades returning nullables. Interface/adapter seams
are out of scope — the policy applies to the engine, not every adapter over it
(a codec implementing an `Effect`-shaped interface stays as it is). The sync
variant is not an Effect and gets no span, no log, no metric; do not wrap it
in one to "keep coverage uniform" — the uniform-coverage rule governs the
*Effect* surface. Two obligations instead: the Effect variant is defined **in
terms of** the Result variant behind its named span (so tracing sees every
Effect-path call and the two can never diverge), and the sync variant's TSDoc
points Effect consumers at the spanned variant. A sync twin whose Effect
sibling lacks a span, or that quietly grows its own logging, is a review
finding — as is an in-scope boundary with no `*Result` twin at all.

Explicit / nested / edge spans:

```ts
const sync = Effect.fn("User.sync")(function* (id: string) {
  const p = yield* fetchProfile(id).pipe(Effect.withSpan("fetchProfile"))
  return yield* persist(p).pipe(Effect.withSpan("persist"))
})
// withSpanScoped   → span open for a Scope's lifetime (resource / streaming ops)
// withParentSpan   → continue an externally-created parent span (framework edge only)
// annotateCurrentSpan({ key }) → stable IDs / small structured values; never
//                    giant payloads, secrets, or noisy transient data
```

## Structured logging

`Effect.log`, `logTrace`, `logDebug`, `logInfo`, `logWarning`, `logError`,
`logFatal`, `annotateLogs` — all `function` in beta.94. They flow through the
current fiber: span context, annotations, and log spans attach automatically.

```ts
yield* Effect.logInfo("starting sync", { userId })   // structured 2nd arg — verified
// Logical label without a full tracing span:
const program = Effect.logInfo("starting sync").pipe(Effect.withLogSpan("user-sync"))
```

Guide rules: log at business boundaries, not every helper; structured values over
concatenated strings; high-signal only; no duplicate logs at every layer. Rely on
spans plus a few well-placed logs. For libraries this means: don't scatter logs
through the engine — a public boundary may log, the hot path does not.

## Metrics

Probed beta.94 `Metric` surface: `counter`, `gauge`, `histogram`, `frequency`,
`summary`, `timer`, `withAttributes`, `withConstantInput`, `linearBoundaries`,
`exponentialBoundaries`, `boundariesFromIterable` — all `function`.

```ts
import { Effect, Metric } from "effect"

const requests = Metric.counter("user_load_requests").pipe(
  Metric.withConstantInput(1)
)

// Attach a metric at a boundary via Effect.track — the post-processing arg to
// Effect.fn. Verified: Effect.fn("name")(gen, Effect.track(metric)) typechecks and runs.
const loadUser = Effect.fn("loadUser")(
  function* (userId: string) {
    return { id: userId }
  },
  Effect.track(requests)
)
```

**v3 → v4 metric deltas** (all confirmed by probe):

- `Metric.tagged` / `Metric.taggedWithLabels` are **gone** (`typeof` →
  `undefined`). Use `Metric.withAttributes({ ... })`; the global
  `Metric.CurrentMetricAttributes` fiber ref carries ambient attributes.
- Histogram boundaries: `Metric.linearBoundaries`, `Metric.exponentialBoundaries`,
  `Metric.boundariesFromIterable` (v3's `MetricBoundaries.*` names are not on the
  `Metric` surface). `Metric.timer` exists; v3 `timerWithBoundaries` does not.
- `Effect.track` is the v4 way to bolt a metric onto an effect / `Effect.fn`.

Guide rule: metrics belong on **boundaries** — endpoint/queue/job handlers,
repository ops, external-API calls, retries — never on every internal helper. For
pure-tier libraries the honest default is **no metrics at all**; let the app meter
its call to the library.

## OpenTelemetry — at the app edge only (UNVERIFIED shapes)

> Everything in this section is **shape per the official guide; verify against
> the installed `@effect/opentelemetry` when first adopted.** The package is not
> in this monorepo. Confirm the beta version compatible with
> the installed `effect` beta and the exact option names before shipping.

Libraries never touch this. An **application** composes one telemetry layer at its
top level:

```ts
// SHAPE PER THE GUIDE — verify option names against the installed package.
const TelemetryLayer = NodeSdk.layer(() => ({
  resource: { serviceName: "todo-service", serviceVersion: "1.0.0" },
  spanProcessor: mySpanProcessor,
  metricReader: myMetricReader,        // temporality: "cumulative" | "delta"
  logRecordProcessor: myLogProcessor
}))

const AppLayer = Layer.mergeAll(DomainLayer, HttpLayer).pipe(
  Layer.provide(TelemetryLayer)
)
```

- `NodeSdk.layer` merges resource + `Tracer.layer` + `Metrics.layer` +
  `Logger.layer` and owns provider lifecycle via scoped acquire/release — **never
  call provider shutdown from business code.**
- `Logger.layer({ mergeWithExisting })` maps Effect levels → OTel severities and
  emits fiber ID, span context, annotations, log-span timing. Prefer merging.
- Bridge external trace context at inbound edges only — `Tracer.makeExternalSpan`,
  `Tracer.currentOtelSpan`, `Effect.withParentSpan` in HTTP/RPC/queue adapters.

**Anti-patterns:** constructing OTel SDK clients inside services; wiring exporters
in domain code; scattering shutdown logic; per-subsystem telemetry config instead
of one top-level layer.

## How to verify quickly

```bash
cd packages/yaml && node --input-type=module -e "
import * as Metric from 'effect/Metric';
console.log(typeof Metric.withAttributes, typeof Metric.tagged);
"   # → function undefined
```

One runtime probe beats an hour of guessing whether a v3 name survived.
