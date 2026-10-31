# @effected/crypto

[![npm](https://img.shields.io/npm/v/@effected%2Fcrypto?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/crypto)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

HMAC sign and verify, constant-time comparison and AWS Signature Version 4 request signing for Effect v4, built on core `effect/crypto`'s `Mac` and `Digest` services. It has no `node:` import, so the same code runs on Node, Bun, Deno, browsers and Cloudflare Workers. It also ships `Fingerprint`, stable SHA-256 fingerprints of JSON-shaped values with a three-way drift decision, and `HttpRedaction`, which strips credentials from HTTP errors before you keep them.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on
> stable Effect v4 and still in `0.x` development. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/crypto

Core `effect/crypto` already computes and checks MACs (`Mac`), hashes bytes (`Digest`) and compares bytes in constant time (`Mac.timingSafeEqual`). Use it directly when you already hold a `Mac` key and the message as one `Uint8Array`, and want raw tag bytes back.

Reach for this package when you need what core leaves to you:

- **The shapes webhooks and APIs use.** `Hmac` takes a `Redacted` string or raw bytes as the key, and a string, bytes or a list of parts as the message, so `${timestamp}.` plus a raw body is signed without building the joined buffer yourself. It returns, or verifies, `hex`, `base64` or `base64url` as well as bytes. A received signature that does not decode answers `false` instead of failing.
- **Comparing a shared secret.** `ConstantTime.secretsEqual` MACs both sides under a fresh random key before comparing them, so neither the secret's length nor a matching prefix leaks.
- **AWS SigV4.** `SigV4.sign` signs a request for S3 or any S3-compatible store (R2, MinIO, Spaces), and returns the exact encoded path and query it signed.
- **Drift detection.** `Fingerprint.of` hashes a canonical JSON form of a value, and `Fingerprint.decide` turns three fingerprints into `Apply`, `Unchanged` or `Drift`.
- **Keeping HTTP errors safely.** Core's `HttpClientError` keeps the live request, `authorization` header included, as a readable field. `HttpRedaction.cause` returns a copy with the credentials replaced.

Every failure is core's `CryptoError` or one of this package's two tagged input errors; nothing in it reads the clock.

## Install

```bash
npm install @effected/crypto effect
```

```bash
pnpm add @effected/crypto effect
```

On Node, requires Node.js >=24.11.0; it also runs on any other WebCrypto runtime, Cloudflare Workers included. `effect` v4 is the only peer, and there are no runtime dependencies. All `@effected/*` packages are ESM-only.

## What to provide

The keyed and hashing operations require core services in `R`, which you provide once at your program's edge:

| Operation | Requires |
| --- | --- |
| `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual`, `SigV4.signingKey` | `Mac.Mac` |
| `SigV4.sign` | `Mac.Mac` and `Digest.Digest` |
| `SigV4.canonicalize`, `Fingerprint.of` | `Digest.Digest` |

`ConstantTime.equal`, `SigV4.encodePath`, `Fingerprint.decide`, `Fingerprint.canonicalizeResult` and every `HttpRedaction` method are pure and need nothing.

| Service | Any WebCrypto runtime (Workers included) | Node |
| --- | --- | --- |
| `Mac.Mac` | `Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto` | `NodeCrypto.layerMac` from `@effect/platform-node` |
| `Digest.Digest` | `Digest.layerWebCrypto` from `effect/crypto` | `NodeCrypto.layerDigest` from `@effect/platform-node` |

```ts
import { Layer } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";

const CryptoLive = Layer.mergeAll(
  Digest.layerWebCrypto,
  Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);
```

On Node, `Layer.mergeAll(NodeCrypto.layerMac, NodeCrypto.layerDigest)` runs on `node:crypto` instead. `NodeServices.layer` provides neither service. On the WebCrypto layers, every HMAC awaits a real promise, so a test that forks one and then adjusts `TestClock` can hang: await it, or gate the clock on a latch.

## Sign and verify an HMAC

```ts
import { Hmac } from "@effected/crypto";
import type { Redacted } from "effect";

const signDelivery = (secret: Redacted.Redacted<string>, timestamp: string, body: Uint8Array) =>
  Hmac.sign({ algorithm: "SHA-256", key: secret, message: [`${timestamp}.`, body], encoding: "hex" });
// Effect<string, CryptoError, Mac>

const verifyDelivery = (secret: Redacted.Redacted<string>, timestamp: string, body: Uint8Array, signature: string) =>
  Hmac.verify({ algorithm: "SHA-256", key: secret, message: [`${timestamp}.`, body], signature, encoding: "hex" });
// Effect<boolean, CryptoError, Mac>
```

`algorithm` is `SHA-256` or `SHA-512`. `encoding` is `hex` (lower case on output, either case on input), `base64` (padded), `base64url` (unpadded) or, when omitted on `sign`, raw bytes. A `Redacted` key is used as its UTF-8 bytes and read only where it is imported. `verify` decodes the received signature and checks it with core's constant-time `Mac.verify`, so any spelling that decodes to the right MAC verifies; one that does not decode, or has the wrong length, answers `false`. An empty key fails with `CryptoError`.

## Compare in constant time

```ts
import { ConstantTime } from "@effected/crypto";
import type { Redacted } from "effect";

// Two digests or MACs, whose length is public:
const sameDigest = ConstantTime.equal(expectedHex, receivedHex);
// boolean

// A shared secret, whose length is not:
const checkApiKey = (expected: Redacted.Redacted<string>, received: string) =>
  ConstantTime.secretsEqual(expected, received);
// Effect<boolean, CryptoError, Mac>
```

`equal` takes two byte arrays or two strings (compared as UTF-8) and returns `false` at once on a length mismatch, which is harmless for digests. `secretsEqual` generates a fresh HMAC-SHA256 key on every call, MACs the expected side and verifies the received side against it, so only two 32-byte tags are ever compared. Both are best-effort: a JavaScript engine is free to optimise a loop, so no comparison in JavaScript is guaranteed constant-time.

## Sign an S3 request

```ts
import type { SigV4Credentials } from "@effected/crypto";
import { SigV4 } from "@effected/crypto";
import { Effect } from "effect";

const readFirstBytes = (credentials: SigV4Credentials, host: string, key: string, now: Date) =>
  SigV4.sign(
    {
      method: "GET",
      host,
      path: key,
      headers: { range: "bytes=0-9" },
      payloadHash: SigV4.EMPTY_PAYLOAD_HASH,
      now,
    },
    credentials,
  ).pipe(
    Effect.map((signed) => ({
      url: `https://${host}${signed.path}${signed.query === "" ? "" : `?${signed.query}`}`,
      headers: signed.headers,
    })),
  );
// Effect<{ url: string; headers: Record<string, string> }, SigV4PathError | CryptoError, Digest | Mac>
```

`SigV4Credentials` holds `accessKeyId`, a `Redacted` `secretAccessKey`, an optional `Redacted` `sessionToken` (sent as `x-amz-security-token`), `region` (`auto` for R2) and `service`. The request carries its own signing instant in `now`, as a `Date` or a `DateTime`, so a signature is reproducible. Pass `path` and `query` unencoded: `sign` encodes the path one segment at a time (escaping `!'()*`, which `encodeURIComponent` leaves alone), sorts and encodes the query, and returns the strings it signed as `path` and `query`. Send exactly those; re-encoding them breaks the signature.

The payload hash is the SHA-256 of `body` unless you pass `payloadHash`: `SigV4.EMPTY_PAYLOAD_HASH` for an empty body, `SigV4.UNSIGNED_PAYLOAD` for a streamed upload, or a hash you computed. The returned `headers` are yours, names lower-cased, plus `host`, `x-amz-date`, `x-amz-content-sha256`, the session token when there is one, and `authorization`.

A path with a segment that is exactly `.` or `..` fails with `SigV4PathError` before anything is signed: every URL parser collapses such a segment, so the request would reach a different path from the one signed. `SigV4.canonicalize` and `SigV4.signingKey` are exported for pinning tests against AWS's documented examples.

## Detect drift

```ts
import { Fingerprint } from "@effected/crypto";
import { Effect } from "effect";

const plan = (applied: string | undefined, live: unknown, desired: unknown) =>
  Effect.gen(function* () {
    const decision = Fingerprint.decide({
      applied,
      live: yield* Fingerprint.of(live),
      desired: yield* Fingerprint.of(desired),
    });
    switch (decision._tag) {
      case "Apply":
        return "apply";
      case "Unchanged":
        return "skip";
      case "Drift":
        return `changed outside this tool: ${decision.applied} is now ${decision.live}`;
    }
  });
// Effect<string, FingerprintError, Digest>
```

A fingerprint is the lower-case SHA-256 hex of a canonical JSON text: object keys sorted at every depth, array order kept, and `undefined` members dropped, so an absent key and an `undefined` one fingerprint alike. Otherwise it follows `JSON.stringify`, with a `Date` written as its ISO string. A value with no faithful JSON form is refused with `FingerprintError`, never coerced: a `bigint`, function, symbol, non-finite number, cycle, or any object that is not a `Date`, an array or a plain object. That includes a `Map`, a class instance, and Effect data types such as `Option`, whatever `toJSON` they carry; encode them to plain JSON first, for example with their `Schema`. `Fingerprint.canonicalizeResult` returns the canonical text as a `Result`, for explaining a drift report.

`decide` applies its rules in order. With no `applied` baseline it answers `Apply`. A `live` that differs from `applied` is `Drift`, carrying both, even when `desired` changed too, because that is when you most want to be told before anything is overwritten. Otherwise, a `desired` that differs from `applied` is `Apply`, and anything else is `Unchanged`. After an `Apply`, persist the desired fingerprint as the next run's `applied`. The three cases are `DriftApply`, `DriftUnchanged` and `DriftDetected`, and `DriftDecision` is their schema union, so a decision can be logged or stored and decoded again.

## Keep an HTTP error without its credentials

```ts
import { HttpRedaction } from "@effected/crypto";
import { Effect, Redacted, Schema } from "effect";
import { HttpClient } from "effect/http";

class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  cause: Schema.Defect(),
}) {}

const fetchManifest = (token: Redacted.Redacted<string>, url: string) =>
  HttpClient.get(url, { headers: { authorization: `Bearer ${Redacted.value(token)}` } }).pipe(
    Effect.mapError((cause) => new RegistryError({ cause: HttpRedaction.cause(cause) })),
  );

HttpRedaction.url("https://user:pw@registry.test/pkg?token=abc&page=2");
// "https://REDACTED:REDACTED@registry.test/pkg?token=REDACTED&page=2"
```

Core redacts credentials only when it renders an error (`toJSON`, inspect). A logger, serializer or anything else that walks the object still reads them, so scrub at the point you keep the cause. `HttpRedaction.cause` copies an `HttpClientError`, a bare error reason, a request or a response, and passes anything else through unchanged.

The copy keeps the method, the status and the URL, with userinfo and sensitive query values replaced by `REDACTED`: core's own list, the SigV4 presigned set, Azure SAS `sig`, `token`, `*_token`, `api_key`, `client_secret`, `secret`, `password` and `code`. Sensitive header values (`authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `private-token`, and the `x-*-token`, `x-*-api-key` and `x-*-signature` family) read `REDACTED`, `set-cookie` and `cookie` are dropped from response headers, and bodies are dropped. A nested foreign cause, such as the `TypeError` a failed fetch rejects with, is rebuilt on the same prototype with its message and stack scrubbed. `HttpRedaction.text` scrubs URLs and `Bearer`, `Basic` and `token` credentials out of free text in linear time, and `HttpRedaction.error`, `request`, `response` and `isSensitiveHeader` are the individual pieces.

## Errors

| Error | Raised by | Meaning |
| --- | --- | --- |
| `CryptoError` (core, `effect/crypto`), reason `InvalidKey` | `Hmac.sign`, `Hmac.verify` | The key is empty. |
| `CryptoError` (core), any reason | `Hmac`, `ConstantTime.secretsEqual`, `SigV4.sign`, `SigV4.signingKey` | The `Mac` layer refused or mishandled a key it should accept. A well-behaved layer does not reach this from `secretsEqual` or SigV4, whose keys are never empty. |
| `SigV4PathError` | `SigV4.sign`, `SigV4.canonicalize` | The path has a segment that is exactly `.` or `..`. Carries `path` and `segment`. |
| `FingerprintError` | `Fingerprint.of`, `Fingerprint.canonicalizeResult` | The value has no canonical JSON form. Carries `path` (a JSON-pointer-like location, `""` for the root) and `detail` (what was found there). |

`CryptoError` means the wiring is wrong, so turn it into a defect with `Effect.orDie`. The two tagged errors are caller input: recover with `Effect.catchTag("SigV4PathError", ...)` or `Effect.catchTag("FingerprintError", ...)`. This package does not re-export `CryptoError`; import it from `effect/crypto`. On the WebCrypto layers, a runtime with no `crypto.subtle` is not a failure at all: the effect dies. `Hmac.verify` reports a malformed signature as `false`, never as an error.

## Testing

The package ships no test double, because none is needed: provide the WebCrypto layers from [What to provide](#what-to-provide) in tests, exactly as a Worker would. To check your own signing against an independent implementation, compare with `node:crypto`'s `createHmac` in the test, or provide `NodeCrypto.layerMac` and `NodeCrypto.layerDigest` and run the same test on both families. Every operation takes its time from the caller, so no test needs `TestClock` to sign or fingerprint.

## What it does not do

- **Hash a stream.** `Digest` hashes bytes already in memory, and no WebCrypto primitive hashes a stream, so hashing a file without holding it in memory needs `node:crypto`.
- **Seal a box.** The libsodium sealed box that GitHub's secrets API needs lives in [`@effected/github`](https://www.npmjs.com/package/@effected/github), because its engines would add runtime dependencies here.
- **Fingerprint by RFC 8785.** `Fingerprint` drops `undefined` members, which RFC 8785 refuses; for RFC 8785 canonical JSON, use `JsoncFingerprint` from [`@effected/jsonc`](https://www.npmjs.com/package/@effected/jsonc).
- **Verify webhooks.** The vendor schemes (GitHub, Stripe, Standard Webhooks, Sanity) live in [`@effected/webhooks`](https://www.npmjs.com/package/@effected/webhooks), which is built on this package.

## License

[MIT](LICENSE)
