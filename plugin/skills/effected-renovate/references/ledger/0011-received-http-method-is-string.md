---
id: "0011"
title: Received HTTP request methods are typed string
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["case \"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\"", "\\.method === \"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\""]
---

The method of a received HTTP request is typed `string`, not the closed `HttpMethod` union. An exhaustive `switch` over it needs a fallback branch, or narrow first with `HttpMethod.isHttpMethod`. From the Effect changelog, not probed by the kit: check the installed `effect/dist/http/HttpMethod.d.ts` and the request type you read it from.

How it shows itself: an exhaustiveness check over the method stops compiling.
