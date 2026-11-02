---
id: "0053"
title: SQL transactions trace as spans, and an idle OTLP exporter lets the process exit
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.2"
detect: ["withTransaction", "Otlp(Tracer|Logger|Exporter)", "SpanPropagationEnabled"]
---

Two observability changes in Effect 4.1.2, from the changelog and the source diff (Effect-TS/effect#10213, #10235). Neither was probed against a consumer.

- **SQL transactions.** `BEGIN`, `COMMIT`, `ROLLBACK` and savepoint statements are now child spans of `sql.transaction`. They replace the `effect.sql.transaction.commit`, `savepoint` and `rollback` span events. With `Statement.SpanPropagationEnabled`, the transaction span also parents the connection spans and records how long it waited for a connection. A test, dashboard or alert that reads those events finds them gone. Look for the spans instead.
- **OTLP exporters.** An idle log or trace exporter no longer keeps a timer pending. A Node program that stayed alive only because of an exporter now exits. If something relied on that to keep a process running, hold the process open explicitly, for example with the layer's own scope or a server.

Check against the installed `effect/dist/sql/SqlClient.d.ts` and `effect/dist/observability/OtlpExporter.d.ts`.
