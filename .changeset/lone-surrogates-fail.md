---
"@effected/crypto": minor
---

## Bug Fixes

* `SigV4.sign` and `SigV4.canonicalize` fail with the new `SigV4EncodingError` on a lone surrogate instead of dying. Its `component` field names where the surrogate was: `path`, `query-key`, `query-value`, `header-name`, `header-value`, `method` or `host`
