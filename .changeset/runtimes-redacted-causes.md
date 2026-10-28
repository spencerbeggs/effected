---
"@effected/runtimes": minor
---

## Bug Fixes

### Security

* `NetworkError` and `ResponseParseError` keep redacted copies of HTTP causes, so no GitHub token is readable from a kept request. `@effected/runtimes` now depends on `@effected/crypto`.
