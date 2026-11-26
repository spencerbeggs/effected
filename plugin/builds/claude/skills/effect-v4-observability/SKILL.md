---
name: effect-v4-observability
description: Use when adding logging, metrics, tracing/spans, or OpenTelemetry to Effect v4 code — covers Effect.fn named spans, the Effect.log* family, custom loggers (Logger.make for the format, Logger.withConsoleLog/withConsoleError for the route — never a hand-written Console.log call), Metric counters/gauges/histograms with Metric.withAttributes (NOT the removed Metric.tagged), and wiring OpenTelemetry export at the app edge (core OTLP layers in effect/observability, Tracer.externalSpan and HttpTraceContext for inbound context, HttpClient.TracerPropagationEnabled for outbound, @effect/opentelemetry only as an optional SDK bridge). Encodes the house rule that pure-tier libraries instrument public fallible boundaries only and stay telemetry-agnostic, while apps compose OTel at the infrastructure layer.
---

# Effect v4 observability

Every Effect-core name below exists in the Effect source, and every claimed
absence is absent there; core's own OTLP exporters (`effect/observability`) are
held to the same standard. This skill names no `@effect/opentelemetry` member;
verify any you use against the installed package. When an API is not listed
here, confirm it against the source or a type-checked probe before writing code.
Module routing (what `Tracer`, `Logger`, `References` are) lives in
`effect-v4-module-index`.

## The house rule (this is the whole point)

> Observability is composed **once, at the infrastructure/edge layer**. Domain
> operations stay telemetry-agnostic. Libraries never import an exporter —
> neither `effect/observability` nor `@effect/opentelemetry`.

The official Effect observability guide endorses this exactly: "business code
stays observability-agnostic; OpenTelemetry is introduced at the infrastructure
layer, not inside domain operations." Our pure-tier libraries (semver, jsonc,
yaml) are a *specialization* of that guide, not a deviation.

**Our specialization for pure-tier parser/engine libraries:** instrument
**public fallible boundaries only** with named `Effect.fn("Name.op")` spans.
**No per-node / hot-path spans.** No metrics on internal helpers. Apps compose an
exporter (core's `Otlp` layers) at their edge and get traces/metrics/logs from the
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
still exported from `Effect.ts`.

```ts
import { Effect } from "effect"

// Named span — our default at PUBLIC FALLIBLE boundaries (Yaml.parse, SemVer.parse).
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

**Pure `Result`-returning siblings of a spanned boundary carry no span** — the
kit's Result-parity rule. A public boundary with `R = never`, no async step and
no IO exposes a pure `*Result` primitive (never `*Sync`), and the spanned Effect
variant is defined in terms of it. Before you add, review or span a sync twin,
load [result-parity.md](references/result-parity.md): it has the scope test, why
`*Sync` is the wrong name, the adapter carve-out and the three review findings.
Wrapping the twin in a span "for uniform coverage" is itself a finding.

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
`logFatal`, `annotateLogs` — all still exported. They flow through the
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

### Custom loggers — format with `Logger.make`, route with `withConsoleLog`

Keep **formatting** and **routing** as two loggers: `Logger.make` renders, and
`Logger.withConsoleLog` / `withConsoleError` route through the `Console`
service. **Never write the routing by hand** with
`o.fiber.getRef(Console.Console).log(...)`; it duplicates core and drifts from
it. Reuse a logger inside another by calling `inner.log(options)`.

```ts
const format = Logger.make((o) => `${o.logLevel}: ${String(o.message)}`)   // Logger<unknown, string>
program.pipe(Effect.provide(Logger.layer([Logger.withConsoleLog(format)])))
```

Before you write a custom logger, or assert on log output in a test, load
[custom-loggers.md](references/custom-loggers.md): it shows the built-in
`console*` loggers are this same composition, `Logger.map` for post-processing,
and exactly what `TestConsole` captures from each route.

## Metrics

The `Metric` surface: `counter`, `gauge`, `histogram`, `frequency`,
`summary`, `timer`, `withAttributes`, `withConstantInput`, `linearBoundaries`,
`exponentialBoundaries`, `boundariesFromIterable` — all exported from
`Metric.ts`.

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

**Names that are easy to reach for and do not exist** (each absence verified
absent in the source):

- There is no `Metric.tagged` / `Metric.taggedWithLabels`. Use
  `Metric.withAttributes({ ... })`; ambient attributes ride on
  `Metric.CurrentMetricAttributes` (`Metric.ts:1623`) — a **`Context.Reference`**,
  and there is no `FiberRef`, so read and scope it the way `effect-v4-idioms`
  describes for any reference: `yield*` it to read, `Effect.provideService` to
  scope a value.
- Histogram boundaries: `Metric.linearBoundaries`, `Metric.exponentialBoundaries`,
  `Metric.boundariesFromIterable` — there is no `MetricBoundaries.*` module on the
  `Metric` surface. `Metric.timer` exists; `timerWithBoundaries` does not.
- `Effect.track` bolts a metric onto an effect / `Effect.fn`.

Guide rule: metrics belong on **boundaries** — endpoint/queue/job handlers,
repository ops, external-API calls, retries — never on every internal helper. For
pure-tier libraries the honest default is **no metrics at all**; let the app meter
its call to the library.

## OpenTelemetry — at the app edge only

Libraries never touch this. An **application** composes one telemetry layer at
its top level: core's `Otlp.layer` / `layerJson` / `layerProtobuf` /
`layerFromConfig` from `effect/observability`, provided an `HttpClient`, and the
optional `@effect/opentelemetry` SDK bridge only when the app must run the SDK
itself.

- **`layerFromConfig` exports nothing** unless `OTEL_<SIGNAL>_EXPORTER` includes
  `otlp` and an endpoint is set; an unset variable counts as an empty list.
- **Request URLs reach exported spans.** `HttpClient` records `url.full`,
  `url.path` and `url.query`, and only a short list of signed-URL query names is
  redacted by default, so a `?token=` or a secret in the path is exported as
  written.
- **Core's `HttpClient` sends `b3` and `traceparent` on every request**: turn
  `HttpClient.TracerPropagationEnabled` off for a client that talks to a third
  party.
- **Never flush or shut down an exporter from business code**; the layers own
  batching and shutdown.

Before you wire telemetry into an app, export from an HTTP client or server that
carries secrets in URLs, or continue an inbound trace, load
[otlp-export.md](references/otlp-export.md): it has the layer examples, the
per-signal environment gate and export intervals, the redaction lists and how to
extend them per `HttpApi`, inbound `HttpTraceContext` and `Tracer.externalSpan`,
the propagation switch, and the SDK-bridge anti-patterns. A misconfigured
`layerFromConfig` exports nothing and reports no error.

## How to verify quickly

```bash
cd packages/<pkg> && node --input-type=module -e "
import * as Metric from 'effect/Metric';
console.log(typeof Metric.withAttributes, typeof Metric.tagged);
"   # → function undefined
```

One runtime probe beats an hour of guessing whether a name exists.

## Additional resources

- [references/result-parity.md](references/result-parity.md) — the Result-parity scope test, the `*Result` naming rule, the adapter carve-out, the two obligations and the review findings. Load when: a public boundary is synchronous and pure, you are adding or reviewing a `*Result` twin, or deciding whether a sync function gets a span.
- [references/custom-loggers.md](references/custom-loggers.md) — `Logger`'s one method, the format/route split, the built-in loggers as the same composition, `Logger.map`, and what `TestConsole` captures. Load when: writing or reviewing a custom logger, routing logs to stdout or stderr, or testing log output.
- [references/otlp-export.md](references/otlp-export.md) — core OTLP layers with examples, the `layerFromConfig` environment gate, export intervals, URL redaction in HTTP spans, inbound and outbound trace context, and the `@effect/opentelemetry` bridge and its anti-patterns. Load when: an app exports traces, metrics or logs, an HTTP client or API carries secrets in a URL, a handler continues an inbound trace, or a client talks to a third-party API.
