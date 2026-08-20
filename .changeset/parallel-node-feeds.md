---
"@effected/runtimes": patch
---

## Performance

`NodeResolver` now fetches the Node dist index and the Node schedule feed concurrently instead of serializing two independent network requests.

- Resolution results, errors, public API, and offline fallback behavior are unchanged; only the live-feed load path overlaps the two HTTP calls.
