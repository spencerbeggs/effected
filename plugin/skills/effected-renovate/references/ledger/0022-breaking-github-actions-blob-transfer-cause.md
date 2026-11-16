---
id: "0022"
title: "@effected/github-actions: @azure/storage-blob is gone, and a failed blob request's BlobTransferError.cause is a BlobRequestError instead of Azure's RestError"
kind: breaking
shows: behavioural
applies:
  "@effected/github-actions": ">=0.35.0"
detect: ["RestError", "@azure/storage-blob", "BlobTransferError"]
closes: ["1364"]
changesets: ["github-actions-blob-transport"]
---

`ActionCache`, `Artifact` and the GitHub-cache `BlobStore` now move bytes through an internal transport on the `HttpClient` their layers already require, instead of `@azure/storage-blob`. Nothing in the layers' types or requirements changed.

- `BlobTransferError.cause` is typed as a defect, so the compiler will not flag this. Where a hit reads Azure `RestError` fields (`statusCode`, `code`, `request`, `details`) off the cause, read the new shape instead. When the HTTP request or its response failed, the cause is an `Error` whose `name` is `"BlobRequestError"`; the class is internal, not exported, so match on `name` and read its fields structurally: method, status code, error code, request id and a redacted URL.
- When a local file failed instead (the upload's stat or read, or the download's write), the cause is the `FileSystem`'s own `PlatformError`, not a `BlobRequestError`. Handle the two separately; do not assume every cause carries a status code.
- Where a hit imports `@azure/storage-blob` only to type or construct that cause, or a test double built on it, remove the import and the dependency.
- Blob requests now go through the consumer-provided `HttpClient`. If the consumer wraps that client to add default headers such as `Authorization`, those headers now reach blob storage too; scope such wrapping to the hosts that need it.

Check the installed `.d.ts` for `BlobTransferError` before matching on its cause.
