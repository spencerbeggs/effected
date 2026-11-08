# @effected/s3

[![npm](https://img.shields.io/npm/v/@effected%2Fs3?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/s3)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

A minimal client for one bucket of an S3-compatible object store (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces) for Effect v4: conditional `put`, `get`, `head`, `delete`, and a strict ListObjectsV2. Requests are signed with `@effected/crypto`'s SigV4 over core `effect/http`'s `HttpClient` and `effect/crypto`'s `Digest` and `Mac`, with no `node:` import, so the same code runs on Node and Cloudflare Workers.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on
> stable Effect v4 and still in `0.x` development. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/s3

An archive, a cache or an ingest service that stores raw objects needs four things from S3: a write that only succeeds once per key (`If-None-Match: *`), a read, a metadata check, and a listing that pages. The AWS SDK brings credential chains, retries and a service catalogue for that; a hand-rolled client over SigV4 tends to get the listing wrong.

This package is the small client, with the failure modes decided:

- **A listing never reads as empty by accident.** A `200` whose body is an `<Error>` document fails as `S3RequestFailed`; an HTML page from a proxy, an empty body, or anything else whose root is not `ListBucketResult` fails as `S3MalformedResponse`. A truncated page without a continuation token, an entry without a `Key`, or a `KeyCount` that disagrees with the entries read also fails, rather than handing back fewer keys.
- **Conditional writes are typed.** A lost `ifNoneMatch` or `ifMatch` is `S3PreconditionFailed`; a conditional write that raced another write to the key (`409 ConditionalRequestConflict`) is `S3ConditionalConflict`, which AWS says to retry; a missing object is `S3NotFound`; an unchanged one is `S3NotModified`. A missing bucket (`NoSuchBucket`), or a `404` from something that is not the store, is `S3RequestFailed`, never "no such object".
- **What is signed is what is sent.** The key goes on the wire exactly as SigV4 encoded and signed it, `!'()*` and non-ASCII included, and every header the client sets is signed.
- **Nothing leaks.** Every kept cause goes through `HttpRedaction.cause`, so no `authorization` header or session token survives in an error; no trace context is sent to the store; every response body is drained.

## Install

```bash
npm install @effected/s3 effect
```

```bash
pnpm add @effected/s3 effect
```

On Node, requires Node.js >=24.11.0; it also runs on Cloudflare Workers and any other runtime with `fetch` and WebCrypto. `effect` v4 is the only peer; `@effected/crypto` is the only dependency. All `@effected/*` packages are ESM-only.

## What to provide

`S3Client.layer` and `S3Client.make` need three core services when the client is made. Provide them once at your program's edge:

| Service | Any WebCrypto runtime (Workers included) | Node |
| --- | --- | --- |
| `HttpClient.HttpClient` | `FetchHttpClient.layer` from `effect/http` | the same, or `NodeHttpClient.layerUndici` from `@effect/platform-node` |
| `Digest.Digest` | `Digest.layerWebCrypto` from `effect/crypto` | `NodeCrypto.layerDigest` from `@effect/platform-node` |
| `Mac.Mac` | `Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto` | `NodeCrypto.layerMac` from `@effect/platform-node` |

Every method's `R` is `never` after that.

## Quick start

```ts
import { S3Client } from "@effected/s3";
import { Effect, Layer, Redacted, Schedule } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";

// Bind the layer to a const: a layer factory mints a fresh layer per call.
const Archive = S3Client.layer({
  bucket: "build-webhooks",
  region: "auto", // R2
  endpoint: "https://<account>.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: Redacted.make("<access key id>"),
    secretAccessKey: Redacted.make("<secret access key>"),
  },
});

const AppLayer = Archive.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Digest.layerWebCrypto),
  Layer.provide(Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
);

const archive = (key: string, json: string) =>
  Effect.gen(function* () {
    const s3 = yield* S3Client;
    return yield* s3.put(key, json, { ifNoneMatch: "*", contentType: "application/json" }).pipe(
      // The write raced another one to this key and was not decided: retry it, as
      // AWS documents, after a pause that lets the write still in flight land. The
      // client never retries on its own.
      Effect.retry({
        while: (error) => error._tag === "S3ConditionalConflict",
        schedule: Schedule.exponential("100 millis"),
        times: 3,
      }),
      Effect.as("created" as const),
      // Somebody already wrote this key: exactly the redelivery case.
      Effect.catchTag("S3PreconditionFailed", () => Effect.succeed("exists" as const)),
    );
  });

Effect.runPromise(archive("raw/2026/11/06/delivery-1.json", "{}").pipe(Effect.provide(AppLayer)));
```

## API

### `S3Client`

| Member | What it does |
| --- | --- |
| `S3Client.layer(options)` | the `S3Client` service for one bucket; needs `HttpClient`, `Digest` and `Mac` |
| `S3Client.make(options)` | the same client as a value, for a program that talks to two buckets |
| `put(key, body, options?)` | write a `Uint8Array` or string; `ifNoneMatch` (`"*"` or an ETag), `ifMatch`, `contentType`, `metadata`; answers `S3PutResult` (`etag`, `versionId`) |
| `get(key, options?)` | read an object; `ifNoneMatch`, `range` (`bytes=0-9`); answers `S3Object` (`body`, `text`, `etag`, `contentType`, `contentLength`, `lastModified`, `metadata`, `contentRange`) |
| `head(key)` | read an object's metadata; answers `S3ObjectHead` |
| `delete(key)` | delete an object; deleting a missing object succeeds, as on S3 |
| `list(options?)` | one ListObjectsV2 page: `prefix`, `delimiter`, `startAfter`, `continuationToken`, `maxKeys`; answers `S3ListPage` (`keys`, `commonPrefixes`, `isTruncated`, `nextContinuationToken` as an `Option`) |
| `listAll(options?)` | a `Stream` of every `S3ObjectSummary` under a prefix, following continuation tokens; `prefix`, `startAfter`, `maxKeys` |

`S3ClientOptions` is `bucket`, `region` (`auto` for R2), an optional `endpoint` (AWS's regional endpoint when omitted), `credentials` (`accessKeyId`, `secretAccessKey` and an optional `sessionToken`, all `Redacted`) and `forcePathStyle`, which defaults to `true` with an endpoint and `false` for AWS, except that a bucket name holding a dot is addressed path style over `https` (as a host label it would not match the wildcard certificate). Bad options (an empty bucket, a bucket with `/`, an endpoint that is not an `http:` or `https:` URL) are a wiring mistake: the layer dies when it is built.

ETags are kept exactly as the store sends them, quotes included, so `ifMatch: head.etag` round-trips. `listAll` takes no `delimiter`, because a stream of objects would drop the common prefixes; page through `list` to read them.

### Errors

Every error carries `operation`, `bucket` and `key` (the prefix, for a listing).

| Error | When |
| --- | --- |
| `S3NotFound` | `404` to a `head`, or a `404` to a `get` whose `<Error>` document's `Code` is `NoSuchKey`; any other `404` to a `get` (`NoSuchBucket`, an HTML page from a proxy, an empty body) is `S3RequestFailed` |
| `S3NotModified` | `304` to a `get` with `ifNoneMatch`; carries the `etag` |
| `S3PreconditionFailed` | `412` to a conditional `put`: the condition lost |
| `S3ConditionalConflict` | `409` to a conditional `put` whose `<Error>` document's `Code` is `ConditionalRequestConflict`: the write raced another write to the key and was not decided; retry it. A `409` with any other code is `S3RequestFailed` |
| `S3RequestFailed` | any other refusal; `status`, and `code`, `s3Message` and `requestId` from the `<Error>` document when there is one (a `200` `<Error>` listing included) |
| `S3MalformedResponse` | an answer the client cannot read: a listing whose root is not `ListBucketResult`, a page missing an element it depends on, a success without an ETag; `expected` and `received` say what |
| `S3TransportError` | the request did not complete; `cause` is the redacted client error |
| `S3InvalidRequest` | the input cannot be sent (an empty key, a key over 1024 bytes or with a `.`/`..` segment, a key, listing option or string body holding a lone UTF-16 surrogate, a bad metadata name, two metadata names that differ only in case, a header value outside printable ASCII, a `maxKeys` outside 1 to 1000); nothing was signed or sent |

`S3PutError`, `S3GetError`, `S3HeadError`, `S3DeleteError` and `S3ListError` name exactly what each operation can raise; `S3Error` is all eight.

No method times out or retries on its own. Bound an operation with `Effect.timeout` and retry with `Effect.retry` at the call site; a timed-out request is interrupted and its connection released.

## Limitations

- **ListObjectsV2 only.** No multipart upload, copy, bucket operations, presigned URLs or the version-1 listing.
- **The listing is read with core `effect/encoding/Xml`**, which is experimental in Effect; it checks well-formedness and never expands entities. A key holding a character XML 1.0 cannot carry (a control character) makes the listing that contains it fail with `S3MalformedResponse`, since the client does not ask for URL-encoded keys.
- **Bodies are held in memory.** `put` takes the whole body and `get` returns it whole; there is no streaming upload or download.

## License

[MIT](./LICENSE)
