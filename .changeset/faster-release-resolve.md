---
"@effected/runtimes": patch
---

## Performance

`ReleaseIndex.resolve` now short-circuits on the first matching release instead of materializing a full filtered array first.

In a local microbenchmark over 20,000 releases, this reduced resolve time by about 9.5x when the first match was mid-list and about 1.8x when no release matched.

- Output and ordering are unchanged: resolution still returns the newest matching release.
- Public APIs and compatibility guarantees are unchanged.
