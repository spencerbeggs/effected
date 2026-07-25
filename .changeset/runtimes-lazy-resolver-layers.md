---
"@effected/runtimes": minor
---

## Breaking Changes

### Resolver layers fetch on first resolve rather than at acquisition

`NodeResolver.layer`, `BunResolver.layer` and `DenoResolver.layer` performed their release-feed fetch when the layer was acquired. Merging all three into one application layer therefore fetched three feeds even when only one runtime was ever resolved, which cost rate limit against the anonymous GitHub quota and logged a snapshot-fallback warning for runtimes nobody asked about.

Population now runs behind a once-gate on the first `resolve` call:

```ts
const layer = Layer.mergeAll(
  NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  BunResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
  DenoResolver.layer.pipe(Layer.provide(GitHubClient.layerDefault)),
);

// before: building this fetched all three feeds
// after: nothing is fetched until a resolver's resolve() is called
```

Concurrent first calls share one fetch. A successful population is memoized for the layer's lifetime, including the auto strategy's fall back to the bundled snapshot, so a dead feed is not re-hammered. A failed fresh population is not memoized, leaving the next `resolve` free to retry.

**Migration.** The freshness error moves out of the layer's error channel and into `resolve`'s, so code that handled it while building the layer now handles it at the call site. Consumers that worked around the old behavior by providing each resolver narrowly inside the branch that used it can merge the layers again.
