---
id: "0010"
title: HttpApiClient.Upgraded values carry a brand
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["HttpApiClient\\.Upgraded", "Upgraded<"]
---

`HttpApiClient.Upgraded` values now carry a `[HttpApiClient.UpgradedTypeId]` brand, so a hand-built mock of one needs it. From the Effect changelog, not probed by the kit: check the installed `effect/dist/http-api/HttpApiClient.d.ts`.

How it shows itself: the compiler rejects a mock without the brand.
