---
id: "0057"
title: "RPC handlers may fail with their server middleware's errors, and the flat client's asQueue error type gains Cause.Done"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.3"
detect: ["accessHandler", "asQueue:"]
---

This applies to code built on `effect/rpc`.

- **Handlers from `RpcGroup.accessHandler` can now fail with their server middleware's errors** (Effect-TS/effect#10418), without those errors being repeated in the RPC's `error` schema. Code that calls such a handler and annotated its error type with only the RPC's own errors must widen that type or handle the middleware errors.
- **The flat `RpcClient`'s `asQueue: true` result now includes `Cause.Done` in its dequeue error type** (Effect-TS/effect#10407), matching the object-shaped client and what the runtime does when it ends the queue. Handle or widen it where you take from that queue.

Check the installed `effect/rpc` `.d.ts`. Verify with your typecheck.
