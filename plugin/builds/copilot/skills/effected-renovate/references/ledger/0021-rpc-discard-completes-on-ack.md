---
id: "0021"
title: RPC discard calls complete on acknowledgement
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["discard: *true", "SchemaBinary"]
---

An RPC call with `discard: true` now completes when the peer acknowledges it, not when it is written. Code that relied on the earlier completion, such as a timeout sized for a write, may need adjusting. Peers using `SchemaBinary` serialization must upgrade together.

Judge each hit: only the `discard` option of an RPC call is affected, and other APIs take an option of the same name.

From the Effect changelog, not probed by the kit. Only tests or production find it.
