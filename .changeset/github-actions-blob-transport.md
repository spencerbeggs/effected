---
"@effected/github-actions": minor
---

## Breaking Changes

* `BlobTransferError.cause` is now an internal error named `BlobRequestError` (method, status code, error code, request id and a redacted URL) instead of Azure's `RestError`. Code that inspects the cause for `RestError` fields must read the new shape.

## Refactoring

* `ActionCache`, `Artifact` and the GitHub-cache `BlobStore` now upload and download through an internal transport on the `HttpClient` the layers already require, which removes about 19 packages from every install.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @azure/storage-blob | dependency | removed | ^12.33.0 | — |
