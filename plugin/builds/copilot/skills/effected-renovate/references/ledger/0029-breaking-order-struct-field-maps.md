---
id: "0029"
title: "effect/Order: Order.Struct and Struct.makeOrder take a Record of orders, compare symbol fields, and return a readonly struct order"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.5"
detect: ["Order\\.Struct\\(", "makeOrder\\("]
---

Field discovery is now the same everywhere: struct comparison, schemas, commands and the collection helpers all read own enumerable string and symbol keys (Effect-TS/effect#10704, #10698). For `Order.Struct` and `Struct.makeOrder` this changes two things.

- **A field map typed by an `interface` may no longer be accepted**, because the parameter is now constrained to `Record<PropertyKey, Order<any>>` and an interface has no implicit index signature. Declare the map with `type Fields = { ... }`, or pass a copy: `Order.Struct({ ...fields })`.
- **The resulting order's input type is `readonly`**, and the `const` type parameter is gone. An explicit type argument or an annotation that names a mutable struct may need `readonly` added.
- **Symbol-keyed fields now take part in the comparison.** A probe on both versions ordered `{ [k]: 1 }` against `{ [k]: 2 }` with `Order.Struct({ [k]: Order.Number })`: the old version answered `0`, the new one `-1`. A sort that relied on symbol fields being ignored now orders by them.

Check the installed `Order` `.d.ts`. Verify with the typecheck and any test that sorts records.
