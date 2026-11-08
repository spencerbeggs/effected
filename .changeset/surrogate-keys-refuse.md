---
"@effected/github-actions": patch
---

## Bug Fixes

* `BlobStore`'s S3 backend fails a key holding a lone UTF-16 surrogate as `BlobStoreError` `invalidKey`, typed and before anything is sent, and an ill-formed host or header as `misconfigured`
