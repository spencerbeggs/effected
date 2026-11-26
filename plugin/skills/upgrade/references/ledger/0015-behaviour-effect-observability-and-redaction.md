---
id: "0015"
title: "effect: the OTLP exporter's queue is bounded, HttpApi redacts schema-backed Redacted values, and batched RPC requests get a root span"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["Otlp|OtlpTracer|OtlpMetrics|OtlpLogger", "HttpApi", "layerProtocolHttp"]
---

- **OTLP export.** The pending export queue is now bounded, with configurable `maxQueueSize` and `onDrop`. Each batch is capped at `maxBatchSize`, exports run with configurable `concurrency` (default `4`, `"unbounded"` allowed, `OtlpMetrics` held at `1`), and `Flusher.flush` waits for all in-flight work. Under heavy load telemetry can now be dropped instead of queuing without limit. Check the defaults in the installed `.d.ts`, and set `maxQueueSize` and `onDrop` if dropped spans or metrics would matter.
- **HttpApi redaction.** Schema-backed `Redacted` path params, query, headers and bodyless payloads are now redacted in `HttpApi` spans and client errors without being listed in `HttpApi.RedactedNames`. A test or dashboard that asserted the raw value in a span attribute or an error message now sees it redacted.
- **RPC batching.** Batched `RpcClient.layerProtocolHttp` requests are traced in a root `RpcClient.batch` span linked to each caller's span, so span trees and counts change.
