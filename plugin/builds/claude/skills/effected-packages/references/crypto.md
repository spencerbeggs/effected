# @effected/crypto

HMAC, constant-time comparison and AWS Signature Version 4 request signing over core `effect/crypto` services, safe for Cloudflare Workers, plus `HttpRedaction`, the kit's one credential scrub for a kept HTTP error. Boundary tier: no `node:` import, no runtime dependency, and `effect` is the only peer. Every HMAC, including the keyed blinding `secretsEqual` uses, comes from core `Mac.Mac` (`effect/crypto`), and every digest of a payload from core `Digest.Digest`, both required in `R`. Failures are core's `CryptoError`; the package defines no crypto error of its own.

## Import

```ts
import { ConstantTime, DriftDecision, Fingerprint, FingerprintError, Hmac, HttpRedaction, SigV4, SigV4PathError } from "@effected/crypto";
import type { HmacAlgorithm, HmacEncoding, HmacKey, HmacMessage, SecretInput, SigV4Credentials, SigV4Request, SigV4Signed } from "@effected/crypto";
```

**Platform**: provide the core layers once at the edge. `Mac.Mac` for `Hmac`, `ConstantTime.secretsEqual`, `SigV4.signingKey` and `SigV4.sign`: core `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` on any WebCrypto runtime (Workers included), or `@effect/platform-node`'s `NodeCrypto.layerMac`. `Digest.Digest` for `SigV4.sign`, `SigV4.canonicalize` and `Fingerprint.of`: core `Digest.layerWebCrypto`, or `NodeCrypto.layerDigest`. `NodeServices.layer` carries no crypto service. `ConstantTime.equal` is pure and needs nothing. Without `crypto.subtle`, the WebCrypto layers still build but an HMAC or a SHA digest **dies**; it is a defect, not a typed failure.

```ts
import { Layer } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";

const CryptoLive = Layer.mergeAll(
  Digest.layerWebCrypto,
  Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);
```

**Async**: on `Mac.layerWebCrypto`, every HMAC (`Hmac.sign`, `Hmac.verify`, `secretsEqual`, `SigV4.sign`) is truly asynchronous: it waits on a promise, so a test that forks one and then adjusts `TestClock` can race or hang. Await it, or gate the clock on a latch.

## Core API

- **`Hmac.sign({ algorithm, key, message, encoding? })`** → `Effect<Uint8Array | string, CryptoError, Mac.Mac>`. `algorithm` is `"SHA-256"` or `"SHA-512"`. `key` is a `Uint8Array` or a `Redacted<string>` (used as its UTF-8 bytes); an empty key fails with core's `CryptoError`, reason `InvalidKey`. `message` is bytes, a string (UTF-8), or a list of those parts (`HmacMessage`), signed as their bytes joined in order, so a prefix plus a raw body needs no joined buffer. `encoding` is `"bytes"` (default), `"hex"` (lower case), `"base64"` (padded) or `"base64url"` (unpadded); the return type follows it.
- **`Hmac.verify({ algorithm, key, message, signature, encoding? })`** → `Effect<boolean, CryptoError, Mac.Mac>`. Checks with `Mac.verify`, which compares in constant time. `signature` is a `Uint8Array`, or a string with a required `encoding` of `hex`, `base64` or `base64url`. A signature that does not decode, or has the wrong length, answers `false` rather than failing; hex is accepted in either case.
- **`ConstantTime.equal(a, b)`** → `boolean`. Bytes or strings (UTF-8), compared with core's `Mac.timingSafeEqual`: no early exit on a mismatch. A length mismatch returns `false` at once, which reveals the length: fine for digests and MACs, not for secrets.
- **`ConstantTime.secretsEqual(expected, received)`** → `Effect<boolean, CryptoError, Mac.Mac>`. MACs the expected side under a fresh HMAC-SHA256 key from `Mac.generateKey` and checks the received side with `Mac.verify`, so neither the secret's length nor a matching prefix reaches the comparison. Inputs are `SecretInput`: bytes, a string or a `Redacted<string>`. Use it for a shared-secret header.
- **`SigV4.sign(request, credentials)`** → `Effect<SigV4Signed, SigV4PathError | CryptoError, Digest.Digest | Mac.Mac>`. `SigV4Signed` is `{ headers, path, query }`: `headers` is yours (lower-cased) plus everything signing added, `host`, `x-amz-date`, `x-amz-content-sha256`, the optional `x-amz-security-token` and `authorization`; `path` is the encoded canonical path and `query` the canonical query string (no `?`, empty when none). **Send `${endpoint}${path}`, plus `?${query}` when non-empty, with those headers, and re-encode nothing.** A path with a segment that is exactly `.` or `..` fails with `SigV4PathError` before signing (as does `canonicalize`): every URL parser collapses it, so it could never be sent as signed. A segment that merely contains dots (`...`, `.a`) or a literal `%2e` (encoded to `%252e`) signs normally. For S3 and S3-compatible stores (R2 uses region `auto`, MinIO, Spaces); the service is a parameter, so it is not S3-only.
  - `SigV4Request`: `method`, `host`, `path` (**unencoded**; encoded per segment inside), `query?` (unencoded, a record or repeated pairs), `headers?`, `body?`, `payloadHash?`, and **`now`** (a `Date` or `DateTime`). Time is never read, so a signature is reproducible.
  - `SigV4Credentials`: `accessKeyId`, `secretAccessKey: Redacted<string>`, `sessionToken?: Redacted<string>`, `region`, `service`.
  - `SigV4.EMPTY_PAYLOAD_HASH` (every GET, HEAD and list) and `SigV4.UNSIGNED_PAYLOAD` (streamed or presigned uploads) go in `payloadHash`; otherwise the body is hashed.
- **`SigV4.encodePath(path)`** — RFC 3986 per-segment encoding that also escapes `!'()*`, which `encodeURIComponent` leaves alone. `sign` already returns the path it encoded; use this only where you need the encoding without signing. It is pure and does **not** normalise: `.` and `..` pass through unchanged, and `sign` is what refuses them. With that exception the path sent is the path signed; any other mismatch fails as an opaque `SignatureDoesNotMatch`.
- **`SigV4.canonicalize(request, credentials)`** → `Effect<SigV4Canonical, SigV4PathError, Digest.Digest>` (no HMAC, so no `CryptoError`): the canonical request, signed headers, payload hash and dates, and **`SigV4.signingKey(secret, dateStamp, region, service)`** — exported so a test can pin them against AWS's documented vectors. `signingKey` is HMAC only, so it requires `Mac.Mac` alone.
- **`Fingerprint.of(value)`** → `Effect<string, FingerprintError, Digest.Digest>` — 64-char lowercase SHA-256 hex of a CANONICAL JSON text, stable across restarts: object keys sorted (UTF-16 code units) at every depth, array order PRESERVED (reordering is a real change), `undefined` object members DROPPED (absent ≡ undefined), `toJSON` honoured, an `undefined` array element written `null`. Refused typed (`FingerprintError { path, detail }`, path JSON-pointer-like): `bigint`, functions, symbols, `NaN`/`Infinity`, cycles, throwing getters, and any non-plain object (`Map`, `Set`, class instances — encode to plain JSON first). NOT RFC 8785: `@effected/jsonc`'s `JsoncFingerprint` refuses `undefined`, which drift detection must treat as absent. `Fingerprint.canonicalizeResult(value)` is the sync canonical text, for explaining a drift report.
- **`Fingerprint.decide({ applied?, live, desired })`** → `DriftDecision` (pure, sync) — `DriftApply` (`_tag: "Apply"`: no baseline, or desired changed and live still matches applied), `DriftUnchanged` (`"Unchanged"`), `DriftDetected` (`"Drift"`, `{ applied, live }`: live departed from applied). Drift WINS when desired also changed, and an out-of-band change that equals desired is still `Drift` (compare `live` with `desired` yourself to treat it as converged). Persist desired's fingerprint as the next `applied` after applying. `DriftDecision` is a `Schema.Union`, so decisions log and round-trip.
- **`HttpRedaction.cause(cause)`** → `unknown` (pure, sync). Call it wherever an error keeps an HTTP cause: `new MyError({ cause: HttpRedaction.cause(cause) })`. Core's `HttpClientError` keeps the live request, `authorization`, `cookie` and `proxy-authorization` included, as a readable field, and redacts only when rendering (`toJSON`, inspect), so a logger or serializer that walks the error reads the token. An `HttpClientError`, a bare reason, a request or a response comes back as a copy: method, URL (userinfo and sensitive query and fragment values `REDACTED`), status and response headers survive; sensitive header values read `REDACTED`, `set-cookie` and `cookie` are dropped from the response, bodies are dropped, and a nested fetch `TypeError` is rebuilt on its own prototype with its URLs redacted and its `code`/`errno`/`port` kept. Anything else (a `SchemaError`, a `PlatformError`, a plain `Error`) passes through by identity. The pieces are exported too: `HttpRedaction.error`, `.request`, `.response`, `.url(url)` (for a URL kept in a string field), `.text(text)` (URLs and `Bearer`/`Basic`/`token` credentials in free text, scheme in any case, value replaced only when credential-shaped so prose survives; linear time) and `.isSensitiveHeader(name)`.
- **`CryptoError`** — core's, from `effect/crypto` (`CryptoError.CryptoError`, tag `"CryptoError"`), not exported by this package: route on `reason._tag` (`InvalidKey` for an empty HMAC key), never on `message`. A wiring defect: `Effect.orDie` it. A digest is never a `CryptoError`: core's `Digest` has no typed failure.
- **`SigV4PathError`** — `{ path, segment }`, both required: a SigV4 path with a segment that is exactly `.` or `..`. Caller input, so recover with `Effect.catchTag("SigV4PathError", ...)` into your own bad-input error (as `BlobStore.layerS3` does with `invalidKey`) and let `CryptoError` die; no `reason` branch needed.

## Rules the package enforces

- Key material stays `Redacted`; it is unwrapped only where its bytes go to `Mac`, and spans carry the algorithm (or region and service), never a key, a MAC or a signature.
- Comparison is best-effort constant time: core's `Mac.timingSafeEqual` is a JavaScript loop the engine could optimise. Compare MACs with `Hmac.verify` or `ConstantTime.equal`, secrets with `secretsEqual`; never `===`.

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

JWT and JWS signing (that is `@effected/jwt`), SHA-1 and SHA-384 HMAC (use core `Mac` directly), key derivation, encryption and asymmetric signatures (core `effect/crypto` ships those as services: `Mac`, `Kdf`, `Aead`/`Cipher`, `Signature`), presigned-URL query signing, and the libsodium sealed box GitHub's secrets API needs: that stays a private leaf of `@effected/github` (`tweetnacl` + `blakejs`, confined to `RepositorySecret`) and does not come here, because an external runtime dependency would retier this boundary package, and `@effected/webhooks` over it, to integrated. A second sealed-box consumer outside `github` gets a new integrated package, never a `@effected/crypto` subpath.
