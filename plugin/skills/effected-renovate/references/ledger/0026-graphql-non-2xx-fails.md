---
id: "0026"
title: A GraphQL call with a non-2xx response now fails
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["GraphQLClient"]
---

A core GraphQL call that gets a non-2xx response now fails, with a `TransportError`, or a `ResponseError` carrying `data` and `errors`, instead of succeeding. Code that read `errors` from a successful result for those responses moves that handling into the error channel.

From the Effect changelog, not probed by the kit. Only tests find it.
