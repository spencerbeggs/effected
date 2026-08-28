# Observability — v3 → v4

Verified against `effect@4.0.0-rc.109` (every row re-checked against the
vendored source). Idiomatic form → see `effect-v4-observability`.

| v3 | v4 |
| --- | --- |
| `Metric.tagged(...)` / `Metric.taggedWithLabels(...)` | **Removed.** `Metric.withAttributes(...)`; ambient attrs come from `Metric.CurrentMetricAttributes`, which is a **`Context.Reference`** (`Metric.ts:1608`), not a fiber ref — `FiberRef` is gone on the v4 line, so set it with `Effect.provideService` |
| `Metric.timerWithBoundaries(...)` | `Metric.timer(...)` |
| `MetricBoundaries.*` (linear/exponential/fromChunk) | `Metric.linearBoundaries` / `Metric.exponentialBoundaries` / `Metric.boundariesFromIterable` (on the `Metric` surface) |
| span/stack-frame ergonomics via `Effect.gen` + manual `withSpan` | `Effect.fn("name")(function* …)` is now the **default constructor** for reusable business ops (auto span + stack frames); `Effect.fn(function* …)` (no name) keeps frames without a named span; `Effect.fnUntraced` is the measured-hot-path escape hatch |
| attach a metric to an effect | `Effect.track(metric)` (post-processing arg to `Effect.fn`) |

Stable/unchanged in v4 (re-checked at rc.109): `Effect.withSpan`,
`withSpanScoped`, `withParentSpan`, `annotateCurrentSpan`, `withLogSpan`, the
`Effect.log*` family.

## Check core before reaching for `@effect/opentelemetry`

**`effect/unstable/observability` ships OTLP export in core** — `Otlp`,
`OtlpTracer`, `OtlpMetrics`, `OtlpLogger`, `OtlpExporter`, `OtlpResource`,
`OtlpSerialization` and `PrometheusMetrics`. On the v3 line every telemetry
export path went through the `@effect/opentelemetry` satellite; on the v4 line
a plain OTLP collector target needs no satellite at all, so an OTel dependency
is a design decision, not a given.

The satellite still exists for the OTel-SDK bridge layers (`NodeSdk.layer`,
`Tracer.layer`, `Metrics.layer`, `Logger.layer`). It is **not installed in this
monorepo** (re-confirmed at rc.109 — it is in the `effect` catalog but nothing
installs it), so those four names are unverified here —
check their option shapes against the actual v4-beta package before citing them.
