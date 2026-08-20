---
"@effected/github-actions": patch
---

## Performance

`CacheKey.hashFiles` now reads the files it hashes concurrently, bounded at 8 at a time, instead of one after another. Hashing a large pattern set — a lockfile-and-sources cache key, say — no longer serializes on file IO.

- The digest is unchanged: paths are still sorted and de-duplicated before hashing, and the per-file digests are still folded into the accumulator in sorted order, so a key computed by this version matches one computed by the previous version and by `@actions/glob`'s `hashFiles`.
