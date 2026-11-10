---
"@effected/github-actions": patch
---

## Bug Fixes

* `@effected/github-actions` imports `@effect/platform-node` by subpath (`NodeCrypto`, `NodeServices`) instead of from its root. The root re-exports `NodeRedis`, so importing it failed with `ERR_MODULE_NOT_FOUND` wherever the optional-in-practice `redis` peer was not installed. A consumer without `redis` can now import the package.
