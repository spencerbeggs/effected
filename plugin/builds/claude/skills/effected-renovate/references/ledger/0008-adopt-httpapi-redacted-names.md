---
id: "0008"
title: "effect/http-api: HttpApi.RedactedNames redacts query parameters and headers in an API's server and client spans"
kind: adopt
shows: none
applies:
  effect: ">=4.1.4"
detect: ["CurrentRedactedNames"]
---

Offer this to the user; never apply it unasked. It replaces a scoped update of `UrlParams.CurrentRedactedNames` or `Headers.CurrentRedactedNames` made inside an `HttpApi` handler or middleware, to keep a sometimes-secret value out of traces.

The server span is recorded after the handler restores its context, so a scoped update made in the handler never reached it. The `HttpApi.RedactedNames` annotation, set on an API, a group or an endpoint, names the query parameters and headers to redact. `HttpApiBuilder` and `HttpApiClient` apply it to the URL and header attributes of their spans (Effect-TS/effect#9995). It extends the global `CurrentRedactedNames` and does not replace them. Like any annotation, a group's own value replaces the API's. `user_agent.original` is recorded as it is.

Where the search matched a scoped `CurrentRedactedNames` around an `HttpApi` handler, add those names as a `RedactedNames` annotation on the endpoint or group, so the server span redacts them. Remove the scoped set only if the handler makes no outbound `HttpClient` request of its own: an `HttpClientError` redacts its URL with the `CurrentRedactedNames` of the fiber that ran the request, and the annotation does not reach that. Keep a global `CurrentRedactedNames` that is not specific to one API. Check the installed `HttpApi` `.d.ts` for the annotation's shape. Verify with a test that records the server span and asserts that the value is redacted.
