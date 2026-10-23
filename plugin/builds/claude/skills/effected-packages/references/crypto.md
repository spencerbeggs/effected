# @effected/crypto

HMAC, constant-time comparison and AWS Signature Version 4 request signing over WebCrypto, safe for Cloudflare Workers. Boundary tier: no `node:` import, no runtime dependency, and `effect` is the only peer. Every digest comes from core `Crypto`, required in `R`; HMAC itself uses `crypto.subtle` read from `globalThis`.

## Import

```ts
import { ConstantTime, CryptoError, Hmac, SigV4 } from "@effected/crypto";
import type { HmacAlgorithm, HmacEncoding, HmacKey, SecretInput, SigV4Credentials, SigV4Request } from "@effected/crypto";
```

**Platform**: provide a `Crypto` layer once at the edge for anything that digests (`ConstantTime.secretsEqual`, `SigV4`). `Hmac` and `ConstantTime.equal` need nothing from `R`. On a runtime without `crypto.subtle`, HMAC fails with `CryptoError { reason: "unsupportedRuntime" }`.

## Core API

- **`Hmac.sign({ algorithm, key, message, encoding? })`** → `Effect<Uint8Array | string, CryptoError>`. `algorithm` is `"SHA-256"` or `"SHA-512"`. `key` is a `Uint8Array` or a `Redacted<string>` (used as its UTF-8 bytes). `message` is bytes or a string (UTF-8). `encoding` is `"bytes"` (default), `"hex"` (lower case), `"base64"` (padded) or `"base64url"` (unpadded); the return type follows it.
- **`Hmac.verify({ algorithm, key, message, signature, encoding? })`** → `Effect<boolean, CryptoError>`. Recomputes the MAC and compares in constant time. `signature` is a `Uint8Array`, or a string with a required `encoding` of `hex`, `base64` or `base64url`. A signature that does not decode, or has the wrong length, answers `false` rather than failing; hex is accepted in either case.
- **`ConstantTime.equal(a, b)`** → `boolean`. Bytes or strings (UTF-8), no early exit on a mismatch. A length mismatch returns `false` at once, which reveals the length: fine for digests and MACs, not for secrets.
- **`ConstantTime.secretsEqual(expected, received)`** → `Effect<boolean, PlatformError, Crypto>`. Hashes both sides with SHA-256 first, so neither the secret's length nor a matching prefix reaches the comparison. Inputs are `SecretInput`: bytes, a string or a `Redacted<string>`. Use it for a shared-secret header.
- **`SigV4.sign(request, credentials)`** → `Effect<Record<string, string>, CryptoError | PlatformError, Crypto>`. Returns the headers to send: yours (lower-cased) plus everything signing added, `host`, `x-amz-date`, `x-amz-content-sha256`, the optional `x-amz-security-token` and `authorization`. Send exactly those. For S3 and S3-compatible stores (R2 uses region `auto`, MinIO, Spaces); the service is a parameter, so it is not S3-only.
  - `SigV4Request`: `method`, `host`, `path` (**unencoded**; encoded per segment inside), `query?` (unencoded, a record or repeated pairs), `headers?`, `body?`, `payloadHash?`, and **`now`** (a `Date` or `DateTime`). Time is never read, so a signature is reproducible.
  - `SigV4Credentials`: `accessKeyId`, `secretAccessKey: Redacted<string>`, `sessionToken?: Redacted<string>`, `region`, `service`.
  - `SigV4.EMPTY_PAYLOAD_HASH` (every GET, HEAD and list) and `SigV4.UNSIGNED_PAYLOAD` (streamed or presigned uploads) go in `payloadHash`; otherwise the body is hashed.
- **`SigV4.encodePath(path)`** — RFC 3986 per-segment encoding that also escapes `!'()*`, which `encodeURIComponent` leaves alone. **Build the request URL from it**, so the path sent is the path signed; a mismatch fails as an opaque `SignatureDoesNotMatch`.
- **`SigV4.canonicalize(request, credentials)`** → the canonical request, signed headers, payload hash and dates, and **`SigV4.signingKey(secret, dateStamp, region, service)`** — exported so a test can pin them against AWS's documented vectors.
- **`CryptoError`** — one tagged error; route on `reason`, never on `message`: `unsupportedRuntime` or `key` (WebCrypto refused the key, for example an empty HMAC key). A digest failure is core's `PlatformError`, not a `CryptoError`.

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

const signGet = (credentials: SigV4Credentials, path: string) =>
  SigV4.sign(
    { method: "GET", host: "bucket.example.com", path, payloadHash: SigV4.EMPTY_PAYLOAD_HASH, now: new Date() },
    credentials,
  );
```

## Where it is used

`@effected/webhooks` verifies every signed scheme through `Hmac` and `ConstantTime`. `@effected/github-actions`'s `BlobStore.layerS3` signs its S3 requests with `SigV4`, so there is no AWS SDK in the graph. Reach for it before `node:crypto` (not available on Workers) or a signing library.

## Not included

JWT and JWS signing (that is `@effected/jwt`), SHA-1 or MD5 HMAC, key derivation (PBKDF2, HKDF), encryption, and presigned-URL query signing.
