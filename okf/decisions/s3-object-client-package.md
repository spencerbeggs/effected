---
type: Decision
title: Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
description: "The kit's S3 object client is a new boundary package, @effected/s3, over core HttpClient, Digest and Mac in R and @effected/crypto's SigV4; not BlobStore.layerS3 in github-actions, and not a subpath of crypto. Its ListObjectsV2 reader decodes through core effect/encoding/Xml and fails a body whose root is not ListBucketResult, never reading it as an empty listing."
status: draft
tags:
  - architecture
  - security
  - bundle
sources:
  - id: issue-1214
    resource: https://github.com/spencerbeggs/effected/issues/1214
    title: "crypto (or a new boundary package): minimal S3 object client — conditional PUT, GET, HEAD, ListObjectsV2"
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-06T00:00:00Z
  - id: blobstore
    resource: ../../packages/github-actions/src/BlobStore.ts
    title: "BlobStore.layerS3: envelope-framed get, put and has over SigV4, no list and no delete, in the integrated github-actions package"
  - id: intake-list
    resource: https://github.com/savvy-web/build/blob/main/intake/src/s3/listObjects.ts
    title: "The intake's regex ListObjectsV2 parser and its root-element check"
  - id: core-xml
    resource: ../../.repos/effect/packages/effect/src/encoding/Xml.ts
    title: "Core effect/encoding/Xml, @stability experimental: event decoding with maxDepth and maxTokenSize, elements() trees, no DOCTYPE entity expansion"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-07T03:13:00Z
integrity:
  generated:
    body: 926b057bdc2cd2e1
---

# Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root

## Context

A service that stores raw objects in R2 or S3 needs conditional `PUT` (`If-None-Match: *`, so the first write for a key wins), `GET`, `HEAD` and paginated `ListObjectsV2`. The kit's only S3 transport is `BlobStore.layerS3` in [`github-actions`](../modules/github-actions.md), which frames every object in its own `BlobEnvelope`, deliberately has no list or delete, and lives in an integrated package with a required `@effect/platform-node` peer.[^blobstore] `savvy-web/build`'s intake therefore wrote its own client over [`crypto`](../modules/crypto.md)'s `SigV4`. Its `ListObjectsV2` parser matched `<Contents><Key>` with regular expressions, so a 200 answer whose body was an `<Error>` document or a proxy's HTML page parsed as a listing with no keys: the replay that read it reported an empty day and exited 0. It was fixed locally with a root-element check.[^issue-1214][^intake-list]

## Decision

The client is a new package, [`@effected/s3`](../modules/s3.md), at boundary tier: `effect` the only peer, `@effected/crypto` its only dependency, core `HttpClient`, `Digest` and `Mac` required in `R`, and no `node:` import, so it runs on Workers.[^owner] Its listing reader is strict:

- The body is decoded by core `effect/encoding/Xml` (`decode`, then `elements` collecting the root as one tree), behind one internal seam, with a nesting depth of 32, a token limit of 1 MiB and an element limit of 8 MiB. The decoder checks well-formedness, rejects a DOCTYPE entity, and decodes the five predefined entities and every character reference.[^core-xml] No hand-written XML reader exists in the package.
- A root of `<Error>` on a 200 is the store's failure, `S3RequestFailed` with its `Code`; any other root that is not `ListBucketResult`, and anything the decoder refuses, is `S3MalformedResponse`, naming what was expected and what was seen. A wrong root is never an empty listing.
- Inside the root, every element the page's meaning depends on is required and checked: `IsTruncated`, each entry's `Key`, `Size` and `LastModified`, the `NextContinuationToken` of a truncated page, and `KeyCount` when present. A missing or malformed one fails the page rather than shortening it. `KeyCount` is accepted when it counts the entries plus the common prefixes (AWS, MinIO) or the entries alone: the second convention has not been observed on a live store, but R2, Ceph and Spaces were not checked, and failing every delimiter listing on a counting convention would trade one silent failure for a loud false one. A page that lost entries matches neither count and still fails.
- The same rule holds outside the listing. A `get` answered `404` is `S3NotFound` only when the body is an `<Error>` document with `Code` `NoSuchKey`: an HTML page from a proxy, an unbound custom domain or a wrong base path answers `404` for every key, and reading that as a missing object is the listing bug moved to `get`. Timestamps are checked for shape and calendar before they are parsed, because `Date` reads `"1"` as 2001 and rolls `30 Feb` over to March.

## Alternatives rejected

- **Extend `BlobStore.layerS3`.** Its contract is an envelope with a metadata channel, and it is integrated tier; adding raw objects and a list to it would make a Worker-side archive depend on the Actions runtime and its platform-node peer.
- **A subpath of `crypto`.** `crypto` is the bottom of the layer graph, pure in its dependencies and depended on by `npm`, `runtimes`, `jwt`, `webhooks` and `github-actions`. An S3 client is a transport, not a primitive, and its error taxonomy, models and XML reading would be reachable from a package every HTTP-speaking kit package depends on.
- **A hand-written XML reader under `src/internal/`.** Core's decoder already does what one would have to: a well-formedness check, entity and character-reference decoding with the `U+10FFFF` bound, no entity expansion, and depth and size limits. A second reader is a second parser to harden.
- **The intake's regex reader with its root check.** It answers the reported bug and nothing past it: a truncated page without a token, a `Contents` without a `Key`, or a page cut short by a proxy still parse as fewer keys.

## Consequences

- Core's `Xml` module is `@stability experimental`. It sits behind `src/internal/xml.ts`, and the package re-verifies that seam whenever the installed `effect` moves.
- A key holding a character XML 1.0 cannot carry, such as a control character, makes the listing that contains it fail with `S3MalformedResponse`, because the client does not request `encoding-type=url`. That is loud rather than silent, and a later option can add URL-encoded listings.
- `listAll` is a stream of object summaries only and takes no `delimiter`, so it cannot drop common prefixes without saying so.
- `BlobStore.layerS3` stays as it is. Moving it onto `@effected/s3` would change its error type and is its own decision.

[^issue-1214]: <https://github.com/spencerbeggs/effected/issues/1214>
[^owner]: conversation with the repository owner
[^blobstore]: `packages/github-actions/src/BlobStore.ts`
[^intake-list]: <https://github.com/savvy-web/build/blob/main/intake/src/s3/listObjects.ts>
[^core-xml]: `.repos/effect/packages/effect/src/encoding/Xml.ts`
