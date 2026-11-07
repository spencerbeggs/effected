---
"@effected/s3": minor
---

## Features

### Initial release

`@effected/s3` is a minimal client for one bucket of an S3-compatible object store (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces). It offers conditional `put`, `get`, `head`, `delete`, a strict `list` and a `listAll` stream. Requests are signed with `@effected/crypto`'s SigV4 over core `HttpClient`, `Digest` and `Mac` in `R`, with no `node:` import, so the same code runs on Node and Cloudflare Workers.

```ts
import { S3Client } from "@effected/s3";
import { Effect, Redacted } from "effect";

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

const archive = (key: string, json: string) =>
  Effect.gen(function* () {
    const s3 = yield* S3Client;
    return yield* s3.put(key, json, { ifNoneMatch: "*", contentType: "application/json" }).pipe(
      Effect.as("created" as const),
      // Somebody already wrote this key: exactly the redelivery case.
      Effect.catchTag("S3PreconditionFailed", () => Effect.succeed("exists" as const)),
    );
  });
```

* A listing never reads as empty by accident: an `<Error>` document on a `200` fails as `S3RequestFailed`, and a proxy's HTML page, an empty body or a page that lost entries fails as `S3MalformedResponse`
* Conditional operations are typed: `S3PreconditionFailed`, `S3NotFound` and `S3NotModified`. A missing bucket, or a `404` from something that is not the store, is `S3RequestFailed` rather than "no such object". `head` has no body to tell these apart
* Caller input that cannot be sent fails as `S3InvalidRequest` before anything goes out
* Causes are redacted, so no `authorization` header or session token survives in an error

Bodies are read fully into memory, and a listing key XML 1.0 cannot carry fails the whole listing.
