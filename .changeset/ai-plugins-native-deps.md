---
"@effected/ai-plugins": patch
---

## Documentation

* The package references describe `@effected/github`'s in-house sealed-box primitives and `@effected/github-actions`' `HttpClient` blob transport in place of `tweetnacl`, `blakejs` and `@azure/storage-blob`.
* The `glob` reference describes the engine as following minimatch 11.0.8, including the leading `!`/`#` rule in `GlobPattern.escape`.
* The upgrade ledger gains entries for the `RepositorySecret` key validation, the `BlobTransferError.cause` shape change and the `glob` 11.0.8 behaviour changes.
