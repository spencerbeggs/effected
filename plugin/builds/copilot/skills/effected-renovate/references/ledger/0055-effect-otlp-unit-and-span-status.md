---
id: "0055"
title: "OTLP exports a metric with no unit as an empty unit, and leaves a successful span's status Unset"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.3"
detect: ["Otlp(Metrics|Tracer)", "OtelTracer", "Otlp\\.layer", "@effect/opentelemetry"]
---

This applies to an application that exports telemetry through core's `Otlp` layers or the `@effect/opentelemetry` bridge. It changes what your backend receives, not your types.

- **A metric with no declared unit now exports an empty unit**, not the dimensionless `"1"` (Effect-TS/effect#10385). Prometheus-compatible backends therefore stop appending `_ratio` to those gauges, so `app_build_info_ratio` becomes `app_build_info`. Update the affected queries and alerts, or set `attributes: { unit: "1" }` on the metric to keep the old name.
- **A span that succeeds, or fails with no reportable error, now keeps the status Unset instead of Ok** (Effect-TS/effect#10440). `OtelTracer` also stops overwriting a status you set directly on the span in those cases. A dashboard or query that filters on Ok must match Unset too.

Verify against a running collector: check one gauge's exported name and one successful span's status.
