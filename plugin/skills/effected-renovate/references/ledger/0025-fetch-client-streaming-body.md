---
id: "0025"
title: FetchHttpClient fails a streaming body it cannot send
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["FetchHttpClient", "HttpBody\\.stream"]
---

`FetchHttpClient` fails a streaming request body it cannot send with an `EncodeError` instead of sending the text `[object ReadableStream]`. A request that "worked" by sending garbage now fails; buffer the body, or use a client that can stream it.

From the Effect changelog, not probed by the kit. Only tests find it.
