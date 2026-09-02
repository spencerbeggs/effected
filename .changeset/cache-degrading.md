---
"@effected/store": minor
---

## Features

### `Cache.degrading` — an opt-in degrade-to-miss posture

Wraps any `Cache` layer so a **construction** failure yields a working, empty cache instead of failing the layer: reads miss, writes are discarded, and the new `CacheShape.degraded` field reads `true`.

```ts
import { Cache } from "@effected/store";

const CacheLayer = Cache.degrading(Cache.layerSqlite({ filename: "cache.db" }));
```

An unreachable or corrupt cache is a cache miss, and must not fail a build that would otherwise succeed. Written inside each service method, that posture holds only while the layer is built inside those methods — hoisting construction to the runtime, an ordinary performance fix, moves the failure to runtime build time where it aborts the whole program. Nothing about that change looks behavioural, and a suite that never fails construction cannot catch it.

Two details are easy to get wrong by hand, and both are handled here:

- **Defects are caught.** `SqliteClient.layer` reports its most common construction failure — a `filename` whose parent directory does not exist — as a defect rather than a typed failure, so a failure-only catch misses exactly the case this exists for.
- **Interruption is not caught.** Interruption is the caller shutting down, not a broken cache; swallowing it would hand a working cache back to a fiber that was meant to stop.
- **Interruption wins on overlap.** When a cause carries both a construction failure and an interrupt — parallel layer construction where one branch fails and another is interrupted — the interrupt path is taken and the failure is not reported. Correct, since a shutting-down fiber must not be handed a working cache, but worth knowing: the failure that also occurred will not appear in the re-raised cause.

This is **opt-in and not the default**. A consumer that wants a cache problem to be fatal, or that wants a narrower per-operation posture with the layer left fatal, keeps exactly that by not calling it. The existing constructors' typed error channels are unchanged.

### `CacheShape.degraded`

New field on the service shape, `false` for every real cache. Without it a cold cache and a broken one are indistinguishable, since every read misses either way. It is a plain field rather than a `CacheEventPayload` member because degradation is decided at construction, before any subscriber exists, and the `events` hub does not replay. The construction failure is also logged once at warning level with its cause.

A consumer hand-implementing `CacheShape` — rather than getting it back from `layer`, `layerSqlite`, `layerTest`, or `Cache.degrading` — must add `degraded` to compile against this release.
