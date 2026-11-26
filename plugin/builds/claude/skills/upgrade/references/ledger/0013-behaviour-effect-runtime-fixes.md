---
id: "0013"
title: "effect: smaller runtime fixes that can change output (Order.clamp, String.linesIterator, DateTime.setParts, FetchHttpClient, Stream.merge, KeyValueStore and more)"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["clamp\\(|between\\(", "linesIterator|linesWithSeparators", "setParts", "FetchHttpClient", "Stream\\.merge|Channel\\.merge|toAsyncIterable", "KeyValueStore", "cors\\(", "ScopedCache|LayerRef", "catchReasons|catchTag\\("]
---

Each of these is a fix, but a test that pinned the old output fails. Search for each pattern and rerun the tests that cover what it finds.

- **`Order.clamp`** (and the module `clamp` wrappers) returns the input, not the bound, when the input compares equal to a bound (probed by identity). It only matters when equal values are distinguishable.
- **`String.linesIterator` / `linesWithSeparators`**: iterating the same iterator again continues from where it stopped instead of restarting at the first line (probed).
- **`DateTime.setParts`** keeps the input's offset when it is valid for the new local time. During or into a repeated DST hour from the later offset it now stays in the second occurrence (`hour: 1` on `03:30 EST` gives `01:30 EST`).
- **`FetchHttpClient`** reads `globalThis.fetch` on every request instead of caching the first one it saw, so a test that replaces `fetch` after the layer is built now takes effect.
- **`Stream.merge` / `Channel.merge`** start both sides at once, so interleaving and side-effect order can change. **`Stream.toAsyncIterable`** no longer drops values or leaves reads pending when `next()` calls overlap.
- **`KeyValueStore.layerFileSystem` / `layerSql`** keep a leading U+FEFF when reading a string value.
- **`HttpMiddleware.cors`** sends `Access-Control-Max-Age: 0` when `maxAge` is `0`.
- **`ScopedCache.get`** moves a reloaded expired entry to most-recently-used, and **`LayerRef`** no longer hands out the previous context after an invalidation while an earlier borrower holds it.
- **Types only:** `Effect.catchReasons` infers a narrower error channel for exhaustive handlers and failing `orElse` fallbacks, and data-first `Effect.catchTag` infers inline calls. An explicit annotation that was widened to satisfy the old inference may now be wider than needed; the compiler reports any real mismatch.

A forked fiber interrupted before it starts now exits interrupted instead of sometimes running its effect, and stream `Atom`s that complete without emitting fail with `NoSuchElementError`. Check the installed `.d.ts` for each module you touch.
