# OpenTelemetry at the app edge

Libraries never touch this. An **application** composes one telemetry layer at
its top level. This reference holds core's OTLP exporters, the environment gate
on `layerFromConfig`, what an HTTP span exports, trace-context bridging in both
directions, and when the SDK bridge is warranted.

## Core OTLP export (`effect/observability`)

Core ships vendor-neutral OTLP exporters, so most apps need no SDK at all.
`Otlp.layer` installs the OTLP logger, metrics exporter and tracer exporter from
one configuration, posting to `/v1/logs`, `/v1/metrics` and `/v1/traces` under
`baseUrl`. It needs an `HttpClient`, and an `OtlpSerialization` that
`layerJson` / `layerProtobuf` already provide:

```ts
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

// Explicit endpoint, JSON encoding.
const TelemetryLayer = Otlp.layerJson({
  baseUrl: "http://localhost:4318",
  resource: { serviceName: "todo-service", serviceVersion: "1.0.0" }
}).pipe(Layer.provide(FetchHttpClient.layer))

// Or from the standard OTEL_* environment (OTEL_SDK_DISABLED, OTEL_EXPORTER_OTLP_*,
// OTEL_<SIGNAL>_EXPORTER, OTEL_BSP_*); this form takes the serialization explicitly.
// It exports nothing until OTEL_<SIGNAL>_EXPORTER includes `otlp` (see below).
const TelemetryFromEnv = Otlp.layerFromConfig({ resource: { serviceName: "todo-service" } }).pipe(
  Layer.provide(OtlpSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
)

const AppLayer = Layer.mergeAll(DomainLayer, HttpLayer).pipe(Layer.provide(TelemetryLayer))
```

- `layer` / `layerJson` / `layerProtobuf` / `layerFromConfig` are the four
  entry points; the per-signal modules (`OtlpTracer`, `OtlpLogger`,
  `OtlpMetrics`) exist for an app exporting only one signal.
- **`layerFromConfig` is gated by the environment, per signal.**
  `Otlp.layerFromConfig` and `OtlpMetrics.layerFromConfig` (and the tracer and
  logger equivalents) export nothing — the layer installs only a flusher, and
  flushing is a no-op — unless `OTEL_<SIGNAL>_EXPORTER` (`OTEL_TRACES_EXPORTER`,
  `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`) includes `otlp` **and** an
  endpoint is set; `OTEL_SDK_DISABLED=true` also disables it. An unset
  `OTEL_<SIGNAL>_EXPORTER` counts as an empty list, so set it explicitly. A
  configuration error in these layers is a defect (`Effect.orDie`), not a typed
  failure. The explicit `layer` / `layerJson` / `layerProtobuf` forms take their
  options directly and have no exporter gate.
- Default export intervals differ by signal: traces 5 s, logs 1 s, metrics
  10 s. Override with `tracerExportInterval`, `loggerExportInterval` and
  `metricsExportInterval` on `Otlp.layer` / `layerJson` / `layerProtobuf` (the
  per-signal modules take plain `exportInterval`); `layerFromConfig`
  reads `OTEL_BSP_SCHEDULE_DELAY` (traces), `OTEL_BLRP_SCHEDULE_DELAY` (logs) and
  `OTEL_METRIC_EXPORT_INTERVAL` (metrics).
- **Request URLs reach exported spans.** Whenever a tracer is live, `effect/http`'s
  `HttpClient` records `url.full`, `url.path` and `url.query` on each request
  span, and the OTLP tracer ships them off the machine. Only the names in
  `UrlParams.CurrentRedactedNames` are redacted by default (the signed-URL
  names `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`,
  `AWSAccessKeyId`, `Signature`, `sig`, `X-Goog-Signature`), so a `?token=`
  query value is exported as written. `url.path` is never redacted, so a secret
  in the path goes out as written too. Extend the list by providing
  `UrlParams.CurrentRedactedNames`; a custom list replaces the defaults.
  For names secret only in one `HttpApi`, annotate the API, group or endpoint
  with `HttpApi.RedactedNames` instead: `HttpApiBuilder` and `HttpApiClient`
  add those query and header names to the global lists in their spans. A scoped
  `CurrentRedactedNames` set inside a handler never reaches the server span,
  which is recorded after the handler's context is restored.
  The exporter's own posts are not traced.
- The layers own export batching and shutdown (`shutdownTimeout`) — **never
  flush or shut an exporter down from business code.**

## Bridging trace context

- **Inbound**, at the HTTP/RPC/queue adapter only: `HttpTraceContext.fromHeaders`
  (`effect/http`) reads `traceparent`/`b3` into an `Option<Tracer.ExternalSpan>`;
  for any other carrier build one with `Tracer.externalSpan({ spanId, traceId })`.
  Parent the handler on it with `Effect.withSpan(name, { parent })` or
  `Effect.withParentSpan(span)`.
- **Outbound**, core's `HttpClient` writes `b3` and `traceparent` on every
  request by default. That is right inside your own system and wrong toward a
  third party, which then receives your trace and span ids. Turn it off per
  client with the `HttpClient.TracerPropagationEnabled` reference; the client
  span is still recorded locally:

  ```ts
  const http = HttpClient.transform(yield* HttpClient.HttpClient, (effect) =>
    Effect.provideService(effect, HttpClient.TracerPropagationEnabled, false)
  )
  ```

  The kit's example is `@effected/github-actions`' S3 `BlobStore`, which signs
  requests to a third-party object store and sends it no trace context.

## `@effect/opentelemetry` (optional SDK bridge)

Reach for it only when the app must run the OpenTelemetry JS SDK itself (its
span processors, an exporter core does not ship, or another library already
instrumented through the SDK). This skill names none of its members, so
**verify every name against the installed package** before writing it; do not take one
from memory or from older guides.

**Anti-patterns:** constructing OTel SDK clients inside services; wiring
exporters in domain code; scattering shutdown logic; per-subsystem telemetry
config instead of one top-level layer; propagating trace headers to a
third-party API.
