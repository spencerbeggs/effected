---
id: "0016"
title: HttpClient.withCookiesRef takes a Ref of a cookie array
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["withCookiesRef"]
---

`HttpClient.withCookiesRef` takes a `Ref<ReadonlyArray<Cookie>>`. Rebuild the ref you pass in that shape. From the Effect changelog, not probed by the kit: check the installed `effect/dist/http/HttpClient.d.ts`.

How it shows itself: the old ref stops compiling.
