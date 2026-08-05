---
"@effected/schemastore": patch
---

## Documentation

- The README quick-start now composes one named layer and provides it once at the boundary, rather than stacking two `Effect.provide` calls at the call site. Both run correctly for this package — `SchemaFile` holds no state — but the stacked form is how a layer ends up built more than once, and the example is what consumers copy. The named const is also reusable, so a drift test and the generator providing the same value cannot disagree about what the layer contains.
