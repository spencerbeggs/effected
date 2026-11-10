# @effected/s3

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.6.0 | 0.7.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Maintenance

- Republish with no code changes, to confirm the package's npm trusted-publishing connection [#1310][#1310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.1.0

### Features

#### Initial release

- `@effected/s3` is a minimal client for one bucket of an S3-compatible object store (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces). It offers conditional `put`, `get`, `head`, `delete`, a strict `list` and a `listAll` stream. Requests are signed with `@effected/crypto`'s SigV4 over core `HttpClient`, `Digest` and `Mac` in `R`, with no `node:` import, so the same code runs on Node and Cloudflare Workers.

```ts
import { S3Client } from "@effected/s3";
import { Effect, Redacted, Schedule } from "effect";

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
      // A write that raced another one to the key was never decided: back off and retry.
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
```

- A listing never reads as empty by accident: an `<Error>` document on a `200` fails as `S3RequestFailed`, and a proxy's HTML page, an empty body or a page that lost entries fails as `S3MalformedResponse`

- Conditional operations are typed: `S3PreconditionFailed`, `S3ConditionalConflict` (a `409` `ConditionalRequestConflict`, to retry), `S3NotFound` and `S3NotModified`. A missing bucket, or a `404` from something that is not the store, is `S3RequestFailed` rather than "no such object". `head` has no body to tell these apart

- Caller input that cannot be sent fails as `S3InvalidRequest` before anything goes out, including a key, listing option or string body holding a lone UTF-16 surrogate (`malformed-unicode`)

- Causes are redacted, so no `authorization` header or session token survives in an error

- Bodies are read fully into memory, and a listing key XML 1.0 cannot carry fails the whole listing. [#1250][#1250]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.5.0 | 0.6.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1250]: https://github.com/spencerbeggs/effected/pull/1250
