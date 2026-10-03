---
"@effected/ai-plugin": patch
---

## Documentation

- The `effect-v4-services-layers` skill now covers pinning a key over a generic shape such as `ConfigFileShape<A>`. It shows how to intersect the plain `Context.Key<I, Shape<A>>` back in, so that `A` is still inferred from the key.
