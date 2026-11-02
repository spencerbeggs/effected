---
id: "0042"
title: Adopt HttpClient.timeout and the transient-failure predicates
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["is(Retryable|Transient)", "retryable(Status|Codes)", "\\[ *(408|429|500|502|503|504) *(, *[0-9]{3} *)+\\]"]
---

Core's `HttpClient.timeout` sets a per-request timeout, and `HttpClient.isTransientError` and `isTransientResponse` are the transient-failure predicates a retry schedule wants.

Where to look: `Effect.timeout` wrapped round each `execute`, and local "is this retryable" helpers or status-code lists. Compare the predicates' coverage with your list before switching. Check the installed `effect/dist/http/HttpClient.d.ts`.
