---
type: Decision
title: The blob transport is internal and HttpClient-based
description: "@effected/github-actions moves bytes against a signed blob url with its own Azure Blob REST transport over HttpClient and FileSystem, in internal/blobTransport.ts, and ships no Azure SDK; the three-module Azure confinement is retired and the reachability suite instead asserts that no @azure package is reachable and that only the three transfer modules reach the transport."
status: stable
x-okfit-supersedes: azure-blob-confined-to-three-modules.md
tags:
  - architecture
  - bundle
  - deps
sources:
  - id: issue-1364
    resource: https://github.com/spencerbeggs/effected/issues/1364
    title: "github-actions: replace @azure/storage-blob with an HttpClient blob transport"
  - id: transport
    resource: ../../packages/github-actions/src/internal/blobTransport.ts
  - id: reachability
    resource: ../../packages/github-actions/__test__/reachability.test.ts
verified:
  - by: human:spencer
    at: 2026-11-16T16:59:20Z
  - by: human:spencer
    at: 2026-11-25T21:38:57Z
x-okfit-integrity:
  generated:
    body: aab4b5de62db32ab
  verified:
    by: human:spencer
    at: 2026-11-25T21:38:57Z
    content: 065e827a1b219f21
generated:
  by: okfit/claude-code
  at: 2026-11-16T17:04:15Z
---

# The blob transport is internal and HttpClient-based

## Context

The cache and artifact results backends answer a Twirp RPC with a signed
(SAS) blob url. The kit called four SDK methods against it
(`uploadData`, `uploadFile`, `downloadToBuffer`, `downloadToFile`), and for
that every consumer installed about nineteen packages: the `@azure/core-*`
family, `@azure/storage-common`, `@typespec/ts-http-runtime`,
`fast-xml-parser` and friends. The earlier decision confined the import to
three modules, which kept the SDK out of a bundle but not out of the
install.

## Decision

`@azure/storage-blob` is removed. `internal/blobTransport.ts` speaks the
Azure Blob REST protocol directly over `HttpClient` and `FileSystem`:

- **Upload**: one `PUT` with `x-ms-blob-type: BlockBlob` up to the
  single-shot threshold (128 MiB for files, 256 MiB for buffers). Above it,
  `PUT ?comp=block&blockid=<base64 of an eight-digit index>` per 64 MiB
  block at concurrency 8, then `PUT ?comp=blocklist` with a `<BlockList>`
  of `<Latest>` ids in order. Each block is read inside the retried
  attempt, so a retry re-reads rather than replaying a consumed stream.
- **Download**: a `GET`, streamed into a `FileSystem` sink or collected to
  bytes; a retry restarts from byte zero.
- **Retry**: transport faults, `408`, `429` and `5xx` retry on a bounded
  exponential schedule; every other status fails at once.
- **Errors**: every failure is a `BlobRequestError` kept as
  `BlobTransferError.cause`, carrying the method, status, the service's
  `<Code>`, the `x-ms-request-id` and the url with its SAS credential
  fields redacted. The request itself and `set-cookie` are never kept.
- **Seam**: `FileBlobTransfer` and `DataBlobTransfer` are unchanged and
  `layerWith(transfer)` still swaps the transport; `layer` builds the
  default from the `HttpClient` and `FileSystem` already in `R`.

The transport is one shared internal module. It has no heavy edge:
it reaches `effect` and `@effected/crypto` for url redaction, so the
rule that kept a shared helper from importing Azure has nothing left to
protect. The reachability suite keeps two checks in its place: no module
reaches any `@azure/*` package, and only the three transfer modules reach
`internal/blobTransport.ts`, so a consumer that imports an outputs accessor
still cannot link the transport.

## Alternatives rejected

**Keep the SDK, confined.** The install closure is paid by every consumer
regardless of confinement.

**Duplicate the transport in each of the three modules.** Done for the
SDK to keep a heavy import off a shared helper's graph. The transport is
plain HTTP over core services, so duplication would triple the block-list
protocol for no reachability gain.

## Consequences

The three layers require `HttpClient` in `R` and the package provides no
platform client of its own: the SDK only hid that dependency, and requiring
it follows [the require-in-R default](../conventions/require-in-r-default.md).

`ActionCache.layer` and `Artifact.layer` already required `HttpClient` and
`FileSystem`, and `GitHubCacheBlobStore.layer` already required
`HttpClient`, so no public `R` changed. The one behavioural difference is
memory: a block is buffered whole (up to 64 MiB, eight at a time) rather
than streamed, because a chunked request body would lack the
`Content-Length` Put Block requires. The `x-ms-version` header is the
service version the SDK sent (`2026-10-06`).
