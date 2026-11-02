---
id: "0024"
title: HttpTraceContext.fromHeaders rejects malformed traceparent
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["HttpTraceContext", "traceparent"]
---

`HttpTraceContext.fromHeaders` rejects uppercase hex IDs and malformed `traceparent` flags, so a span from such a caller is no longer parented. Fix any producer of these headers you control, and any test fixture built with uppercase IDs.

From the Effect changelog, not probed by the kit. Only tests find it.
