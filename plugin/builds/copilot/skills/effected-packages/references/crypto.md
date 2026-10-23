# @effected/crypto

HMAC, constant-time comparison and AWS Signature Version 4 request signing over WebCrypto, safe for Cloudflare Workers. Boundary tier: no `node:` import, no runtime dependency, and `effect` is the only peer. Every digest of a payload comes from core `Crypto`, required in `R`; HMAC, including the keyed blinding `secretsEqual` uses, comes from `crypto.subtle` read from `globalThis`.

## Import

```ts
import { ConstantTime, CryptoError, Hmac, SigV4, SigV4PathError } from "@effected/crypto";
import type { HmacAlgorithm, HmacEncoding, HmacKey, HmacMessage, SecretInput, SigV4Credentials, SigV4Request, SigV4Signed } from "@effected/crypto";
```

**Platform**: provide a `Crypto` layer once at the edge for `SigV4`, the one thing that digests. `Hmac`, `ConstantTime.equal` and `ConstantTime.secretsEqual` need nothing from `R`. On a runtime without `crypto.subtle`, they fail with `CryptoError { reason: "unsupportedRuntime" }`.

**Async**: every WebCrypto call (`Hmac.sign`, `Hmac.verify`, `secretsEqual`, `SigV4.sign`) is truly asynchronous: it waits on a promise, so a test that forks one and then adjusts `TestClock` can race or hang. Await it, or gate the clock on a latch.

## Core API

- **`Hmac.sign({ algorithm, key, message, encoding? })`** → `Effect<Uint8Array | string, CryptoError>`. `algorithm` is `"SHA-256"` or `"SHA-512"`. `key` is a `Uint8Array` or a `Redacted<string>` (used as its UTF-8 bytes). `message` is bytes, a string (UTF-8), or a list of those parts (`HmacMessage`), signed as their bytes joined in order, so a prefix plus a raw body needs no joined buffer. `encoding` is `"bytes"` (default), `"hex"` (lower case), `"base64"` (padded) or `"base64url"` (unpadded); the return type follows it.
- **`Hmac.verify({ algorithm, key, message, signature, encoding? })`** → `Effect<boolean, CryptoError>`. Recomputes the MAC and compares in constant time. `signature` is a `Uint8Array`, or a string with a required `encoding` of `hex`, `base64` or `base64url`. A signature that does not decode, or has the wrong length, answers `false` rather than failing; hex is accepted in either case.
- **`ConstantTime.equal(a, b)`** → `boolean`. Bytes or strings (UTF-8), no early exit on a mismatch. A length mismatch returns `false` at once, which reveals the length: fine for digests and MACs, not for secrets.
- **`ConstantTime.secretsEqual(expected, received)`** → `Effect<boolean, CryptoError>`. MACs both sides under a fresh, non-extractable HMAC-SHA256 key from WebCrypto first, so neither the secret's length nor a matching prefix reaches the comparison. Inputs are `SecretInput`: bytes, a string or a `Redacted<string>`. Use it for a shared-secret header.
- **`SigV4.sign(request, credentials)`** → `Effect<SigV4Signed, SigV4PathError | CryptoError | PlatformError, Crypto>`. `SigV4Signed` is `{ headers, path, query }`: `headers` is yours (lower-cased) plus everything signing added, `host`, `x-amz-date`, `x-amz-content-sha256`, the optional `x-amz-security-token` and `authorization`; `path` is the encoded canonical path and `query` the canonical query string (no `?`, empty when none). **Send `${endpoint}${path}`, plus `?${query}` when non-empty, with those headers, and re-encode nothing.** A path with a segment that is exactly `.` or `..` fails with `SigV4PathError` before signing (as does `canonicalize`): every URL parser collapses it, so it could never be sent as signed. A segment that merely contains dots (`...`, `.a`) or a literal `%2e` (encoded to `%252e`) signs normally. For S3 and S3-compatible stores (R2 uses region `auto`, MinIO, Spaces); the service is a parameter, so it is not S3-only.
  - `SigV4Request`: `method`, `host`, `path` (**unencoded**; encoded per segment inside), `query?` (unencoded, a record or repeated pairs), `headers?`, `body?`, `payloadHash?`, and **`now`** (a `Date` or `DateTime`). Time is never read, so a signature is reproducible.
  - `SigV4Credentials`: `accessKeyId`, `secretAccessKey: Redacted<string>`, `sessionToken?: Redacted<string>`, `region`, `service`.
  - `SigV4.EMPTY_PAYLOAD_HASH` (every GET, HEAD and list) and `SigV4.UNSIGNED_PAYLOAD` (streamed or presigned uploads) go in `payloadHash`; otherwise the body is hashed.
- **`SigV4.encodePath(path)`** — RFC 3986 per-segment encoding that also escapes `!'()*`, which `encodeURIComponent` leaves alone. `sign` already returns the path it encoded; use this only where you need the encoding without signing. It is pure and does **not** normalise: `.` and `..` pass through unchanged, and `sign` is what refuses them. With that exception the path sent is the path signed; any other mismatch fails as an opaque `SignatureDoesNotMatch`.
- **`SigV4.canonicalize(request, credentials)`** → `Effect<SigV4Canonical, SigV4PathError | PlatformError, Crypto>` (no HMAC, so no `CryptoError`): the canonical request, signed headers, payload hash and dates, and **`SigV4.signingKey(secret, dateStamp, region, service)`** — exported so a test can pin them against AWS's documented vectors.
- **`CryptoError`** — the wiring-defect error; route on `reason`, never on `message`: `unsupportedRuntime` or `key` (WebCrypto refused the key, for example an empty HMAC key). Both are defects: `Effect.orDie` them. A digest failure (SigV4 only) is core's `PlatformError`, not a `CryptoError`.
- **`SigV4PathError`** — `{ path, segment }`, both required: a SigV4 path with a segment that is exactly `.` or `..`. Caller input, so recover with `Effect.catchTag("SigV4PathError", ...)` into your own bad-input error (as `BlobStore.layerS3` does with `invalidKey`) and let `CryptoError` die; no `reason` branch needed.

## Rules the package enforces

- Key material stays `Redacted`; it is unwrapped only where the key is imported or derived, and spans carry the algorithm (or region and service), never a key, a MAC or a signature.
- Comparison is best-effort constant time: WebCrypto has no `timingSafeEqual`, so it is a JavaScript loop the engine could optimise. Compare MACs with `Hmac.verify` or `ConstantTime.equal`, secrets with `secretsEqual`; never `===`.

## Usage

```ts
import { Hmac } from "@effected/crypto";
import type { Redacted } from "effect";

// Verify a hex HMAC-SHA256 over a raw body.
const check = (secret: Redacted.Redacted<string>, body: Uint8Array, signature: string) =>
  Hmac.verify({ algorithm: "SHA-256", key: secret, message: body, signature, encoding: "hex" });
```

```ts
import { SigV4 } from "@effected/crypto";
import type { SigV4Credentials } from "@effected/crypto";
import { Effect } from "effect";

const signGet = (credentials: SigV4Credentials, key: string) =>
  SigV4.sign(
    { method: "GET", host: "bucket.example.com", path: key, payloadHash: SigV4.EMPTY_PAYLOAD_HASH, now: new Date() },
    credentials,
  ).pipe(
    // The target exactly as signed: never rebuild it with encodeURIComponent or a URL join.
    Effect.map(({ headers, path, query }) => ({
      url: `https://bucket.example.com${path}${query ? `?${query}` : ""}`,
      headers,
    })),
  );
```

## Where it is used

`@effected/webhooks` verifies every signed scheme through `Hmac` and `ConstantTime`. `@effected/github-actions`'s `BlobStore.layerS3` signs its S3 requests with `SigV4`, so there is no AWS SDK in the graph. Reach for it before `node:crypto` (not available on Workers) or a signing library.

## Not included

JWT and JWS signing (that is `@effected/jwt`), SHA-1 or MD5 HMAC, key derivation (PBKDF2, HKDF), encryption, and presigned-URL query signing.
