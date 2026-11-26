---
id: "0017"
title: "effect: RFC 8288 Link header parsing and header-appending helpers"
kind: adopt
shows: none
applies:
  "effect": ">=4.1.6"
detect: ["rel=[^a-z]*(next|prev|last)|parse-link-header"]
---

`Headers.parseLink`, `Headers.formatLink`, `Schema.LinkHeaderFromString` and `HttpClientResponse.links` / `link` now read and write RFC 8288 `Link` headers. `Headers.append`, `HttpClientRequest.appendHeader` and `HttpServerResponse.appendHeader` add a header value without replacing an existing one.

If the project parses `Link` headers by hand (GitHub-style pagination with `rel="next"`, for example) or uses a `parse-link-header` dependency, consider replacing it with these. Check the installed `effect/http` `.d.ts` for the exact shapes.
