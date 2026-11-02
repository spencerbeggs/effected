---
id: "0014"
title: AiError request details and DecideOptions images are removed
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["HttpRequestDetails", "NetworkError", "DecideOptions"]
---

`AiError.HttpRequestDetails` and `Response.HttpRequestDetails` are removed; `AiError.NetworkError` records `method` and `url` instead of `request`. `DecideOptions.images` is removed in favour of `Decision.Image` input fields. From the Effect changelog, not probed by the kit: check the installed `effect/dist/ai/*.d.ts`.

How it shows itself: reads of the removed fields stop compiling.
