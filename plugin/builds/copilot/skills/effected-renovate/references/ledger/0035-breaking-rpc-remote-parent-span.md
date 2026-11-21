---
id: "0035"
title: "effect/rpc: handler and middleware options carry a required remoteParentSpan, and Rpc.TracingEnabled selects spans per procedure"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.5"
detect: ["RpcMiddleware", "clientId:", "Rpc\\.ToHandlerFn", "Rpc\\.Handler<"]
---

RPC tracing is now chosen per procedure with the `Rpc.TracingEnabled` annotation, and a custom handler or middleware span is parented through a new `remoteParentSpan` option (Effect-TS/effect#10780). The options object a handler and a middleware receive gained a required `remoteParentSpan: Tracer.ExternalSpan | undefined`.

- **Where a hit invokes a handler or a middleware directly**, as a unit test usually does, passing `{ clientId, requestId, headers, rpc, … }`, add `remoteParentSpan: undefined` when no client span context was received. The compiler finds each call.
- **Where a hit parents a custom span inside a handler or middleware**, use `remoteParentSpan` instead of reconstructing the parent from headers.
- **Where a hit turned automatic spans off for a whole server**, consider annotating only the procedures that should not be traced.

Code that serves an `RpcGroup` through `RpcServer` is unaffected; the server supplies the option. Check the installed `Rpc` and `RpcMiddleware` `.d.ts`. Verify with the typecheck.
