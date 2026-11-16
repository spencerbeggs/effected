---
"@effected/ai-plugins": patch
---

## Documentation

* The package references describe `@effected/github`'s in-house sealed-box primitives and `@effected/github-actions`' `HttpClient` blob transport in place of `tweetnacl`, `blakejs` and `@azure/storage-blob`.
* The upgrade ledger gains entries for the `RepositorySecret` key validation and the `BlobTransferError.cause` shape change.
