# Observability — v3 → v4

Verified against `effect@4.0.0-beta.94`. Idiomatic form → see
`effect-v4-observability`.

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
