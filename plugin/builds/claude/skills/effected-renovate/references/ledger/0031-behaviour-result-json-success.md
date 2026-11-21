---
id: "0031"
title: "effect/Result: a serialized Result.Success writes its value under success instead of value"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.5"
detect: ["\"_id\": ?\"Result\"", "_id: \"Result\"", "_tag\": ?\"Success\""]
---

`Result.Success`'s `toJSON`, and so `JSON.stringify` and Node's inspection output, now name the field after the `success` property (Effect-TS/effect#10663). A probe on both versions printed `JSON.stringify(Result.succeed(1))`: the old version wrote `{"_id":"Result","_tag":"Success","value":1}`, the new one `{"_id":"Result","_tag":"Success","success":1}`.

This changes text, not the in-memory `Result`. Update any snapshot, fixture or expected string that shows a serialized `Result`, and any consumer of logged or stored JSON that read `value` from it, to read `success`. Code that reads the `success` property of a live `Result` is unaffected. Verify with the snapshot and logging tests.
