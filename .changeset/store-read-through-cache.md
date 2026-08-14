---
"@effected/store": minor
"@effected/app": patch
---

## Features

### `Cache.through` — read-through caching in one call

`get` → decode → on miss fetch → encode → `set` was roughly twenty-five lines every consumer wrote for itself. It is now one:

```ts
const members = yield* Cache.through("team:platform", Schema.fromJsonString(Members), {
	ttl: "1 hour",
	tags: ["team"],
})(fetchMembersFromApi);
```

`Cache.throughVerbose` returns `{ value, hit }` for callers that need to say *(cached)* in their output — previously only reachable by subscribing to the `CacheEvent` PubSub and correlating by key, which is a telemetry channel being used as a return value.

Two policies the package now owns rather than leaving to each consumer:

* **A stored value that fails to decode is a miss, not a failure.** Those bytes were written by an older build of the caller's own program; the user did not cause it, cannot fix it without knowing the cache exists, and everything cached is re-derivable by definition. The stale entry is overwritten on the way out.
* **`CacheError` is surfaced, not swallowed.** A cache is additive and a caller may reasonably want to push through a broken one, but that is the caller's decision to make with `Effect.catchTag("CacheError", …)`. A database that cannot be read is real and reportable, so it is not hidden here.

### `Uint8ArrayFromUtf8` — the missing UTF-8 codec

Core's Schema ships `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and `Uint8ArrayFromHex`, and nothing for UTF-8. So this package's own advice — cache values are bytes, encode them deliberately through a schema — could not be followed to the end: `Schema.fromJsonString(schema)` reaches `string` and stops. Consumers hand-wired a `TextEncoder` at exactly the seam the advice exists to close, or paid base64's 33% size premium to stay inside Schema.

`Uint8ArrayFromUtf8` closes it. Encoding fails on malformed UTF-8 rather than substituting replacement characters, so a corrupt value stays distinguishable from a valid one containing `U+FFFD`.

## Documentation

* `Cache` and `App.layer` now document the `TestClock` ordering that decides whether cache expiry is testable at all: provide `TestClock.layer()` **outside** the `Effect.provide` supplying the cache, never beneath it. Underneath, the test body has no `TestClock` in its context and `TestClock.adjust` dies as a defect, so nothing you try to expire ever expires.
