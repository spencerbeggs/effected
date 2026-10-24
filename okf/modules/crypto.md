---
type: Module
title: "@effected/crypto"
description: HMAC, constant-time comparison and AWS SigV4 request signing over WebCrypto, with no node imports, for the keyed primitives core Crypto does not offer.
status: draft
kind: package
resource: ../../packages/crypto
layer: L1
tags:
  - architecture
  - security
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: core-crypto
    resource: ../../.repos/effect/packages/effect/src/Crypto.ts
    title: "Core Crypto at 4.0.6: random bytes, random numbers, UUIDs, ULID and a one-shot digest; no HMAC, no key import"
  - id: actions-sigv4
    resource: https://github.com/spencerbeggs/effected/blob/e8990d4f/packages/github-actions/src/internal/sigv4.ts
    title: "The retired github-actions SigV4 copy: session token, per-segment path encoding, explicit now, node:crypto createHmac"
  - id: intake-sigv4
    resource: https://github.com/savvy-web/build/blob/main/intake/src/s3/SigV4.ts
    title: "The intake SigV4 copy: canonical query, caller-supplied payload hash, EMPTY_PAYLOAD_HASH, encodeRfc3986Path"
  - id: intake-hmac
    resource: https://github.com/savvy-web/build/blob/main/intake/src/vendors/hmac.ts
    title: "Intake's HMAC helpers and its hashed secretsEqual"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-24T00:28:31Z
integrity:
  generated:
    body: 1456dcb01ecb5abd
---

# `@effected/crypto`

`@effected/crypto` holds the keyed cryptographic primitives the kit needs and core `Crypto` does not offer: HMAC sign and verify, constant-time comparison, and AWS Signature Version 4 request signing. It exists because two SigV4 implementations and an HMAC helper set were written independently, one in [`github-actions`](github-actions.md) and two in the `savvy-web/build` intake service, all on `node:crypto`, and because the inbound verifiers in [`webhooks`](webhooks.md) need the same HMAC on runtimes with no `node:crypto`.[^owner][^actions-sigv4][^intake-sigv4][^intake-hmac]

## Tier and dependencies

Boundary tier, with no `node:` import under `src/`, so it runs on Node, browsers and Cloudflare workerd, matching [`jwt`](jwt.md). There are no runtime dependencies; `peerDependencies` is `effect` alone. The backend split is its own decision: [HMAC comes from WebCrypto, digests from core `Crypto` in `R`](../decisions/crypto-backends.md). The libsodium sealed box that GitHub's secrets API needs is not here and does not come here: `tweetnacl` and `blakejs` would retier this package and `webhooks` to integrated, so [the sealed box stays in `github`](../decisions/sealed-box-home.md) until a second consumer appears, and then moves to a new package rather than a subpath of this one.

## Core-owned list

Core `Crypto` at 4.0.6 offers random bytes, random numbers, UUIDv4/v7, ULID and a one-shot `digest` over bytes already in memory, and nothing keyed.[^core-crypto] So a digest is always core's `Crypto.digest`, required in `R`, never re-wrapped here; hex, base64 and base64url are `effect/encoding`; time is a caller-supplied instant, never `Date.now()`. What this package owns is exactly what core lacks: HMAC, constant-time comparison, and the SigV4 algorithm on top of them. A streamed digest (hashing a file without holding it in memory) is out of scope: no WebCrypto primitive hashes a stream, which is why `github-actions` keeps `node:crypto` for `digestFile`.

## Modules

| File | Responsibility |
| --- | --- |
| `src/CryptoError.ts` | the wiring-defect tagged error, `reason` `unsupportedRuntime` or `key` |
| `src/SigV4PathError.ts` | the caller-input tagged error for a SigV4 path with a `.` or `..` segment, carrying `path` and `segment` |
| `src/internal/subtle.ts` | `globalThis.crypto?.subtle` acquisition and the `unsupportedRuntime` failure, as in `jwt` |
| `src/Hmac.ts` | `Hmac.sign` and `Hmac.verify` for SHA-256 and SHA-512 |
| `src/ConstantTime.ts` | `ConstantTime.equal` and `ConstantTime.secretsEqual` |
| `src/SigV4.ts` | `SigV4Signed`, `SigV4.canonicalize`, `SigV4.signingKey`, `SigV4.sign`, `SigV4.encodePath`, `SigV4.EMPTY_PAYLOAD_HASH`, `SigV4.UNSIGNED_PAYLOAD` |
| `src/index.ts` | root entrypoint, re-exporting by name only |

The package follows the [module-per-concept layout](../conventions/module-per-concept-layout.md). Grouped statics are classes, never `as const` objects, per [no barrel re-exports](../conventions/no-barrel-re-exports.md).

## Behaviour

- **`Hmac`.** The key is raw bytes or a `Redacted<string>` (UTF-8 encoded at import, and `Redacted.value` read only there). The message is bytes, a string, or a list of those parts joined as bytes in order, so a prefix plus a raw body needs no caller-built buffer. Output is selected by an `encoding` option: `bytes`, `hex` (lower case), `base64` (padded) or `base64url` (unpadded). The last is what Sanity signs with. `Hmac.verify` recomputes and compares with `ConstantTime.equal`, so a caller never writes the comparison by hand. Both return an `Effect`, because WebCrypto's `sign` is asynchronous; that is the cost of running on workerd, and every caller absorbs it.
- **`ConstantTime.equal(a, b)`** compares two byte arrays or two strings with an XOR accumulator over the full length and no early return on a mismatched byte. A length mismatch returns `false`. Its guarantee is best-effort, recorded in [the constant-time limitation](../limitations/constant-time-compare.md).
- **`ConstantTime.secretsEqual(expected, received)`** MACs both sides with HMAC-SHA256 under a fresh, non-extractable key from WebCrypto's `generateKey` and compares the MACs, so neither the secret's length nor a prefix match leaks. It is the comparison for a shared-secret header. It is keyed, so it sits on the WebCrypto side of [the backend split](../decisions/crypto-backends.md): nothing in `R`, and `CryptoError` as its only failure.
- **`SigV4`** is the union of both earlier copies. From `github-actions`: the optional session token as `x-amz-security-token`, per-segment path encoding that also escapes `!'()*` (which `encodeURIComponent` leaves alone and AWS does not), and the signing instant passed in. From intake: a canonical query string (key then value sorted, both RFC 3986 encoded), and a payload hash the caller may supply, so `UNSIGNED-PAYLOAD` and the precomputed empty-body hash work. `sign` returns `SigV4Signed`: the caller's headers plus every header signing added, the encoded canonical path and the canonical query string, so the caller sends `${endpoint}${path}` (and `?${query}` when non-empty) with those headers and nothing re-encodes. Every URL parser collapses a `.` or `..` segment, `%2e` spellings included, so a path holding one cannot reach the store as signed; encoding cannot fix that, since both are unreserved. So `canonicalize` and `sign` refuse a path with a segment that is exactly `.` or `..`, with `SigV4PathError` (carrying the `path` and the offending `segment`), before anything is hashed, and every caller inherits the refusal. `canonicalize` takes no HMAC, so its error channel is `SigV4PathError | PlatformError` with no `CryptoError`; `sign` adds `CryptoError`. Only the exact segments are refused: the path is unencoded, so a literal `%2e` is encoded to `%252e`, which no parser collapses. `encodePath` stays pure and does not normalise. `canonicalize` and `signingKey` are exported so tests pin them against AWS's own documented examples rather than against this implementation.

- **Asynchrony.** Every WebCrypto call is truly asynchronous: a test that forks `Hmac.sign`, `Hmac.verify`, `secretsEqual` or `SigV4.sign` and then adjusts `TestClock` can race or hang, and needs a latch or an `Effect.yieldNow` loop.

## Errors

`CryptoError` has `reason` `unsupportedRuntime` (no `crypto.subtle`) or `key` (WebCrypto refused the key material). Both are wiring defects, which a caller turns into a defect with `orDie`; the `message` names the runtime or the algorithm, never the key. A SigV4 path with a `.` or `..` segment is caller input, which a caller plausibly recovers from on its own, so it is its own tag, `SigV4PathError`, with required `path` and `segment` fields that its `message` names, per [per-reason tagged errors](../decisions/github-actions-per-reason-tagged-errors.md): a caller recovers with `catchTag("SigV4PathError", ...)` and lets `CryptoError` die without branching on `reason`. Malformed input to a verifier is not this package's error: `Hmac.verify` answers `false`, and the [`webhooks`](webhooks.md) presets turn that into their own typed reasons.

## Observability

Named `Effect.fn` spans on `Hmac.sign`, `Hmac.verify` and `SigV4.sign`. No key, secret or signature is ever annotated; the algorithm and the SigV4 region and service are.

## Testing

SigV4 is pinned to the AWS documented worked examples (the `AKIAIOSFODNN7EXAMPLE` key pair on 2013-05-24), lifted from intake's suite, plus the `github-actions` suite's canonical-request assertions. HMAC is pinned to the RFC 4231 test vectors. `ConstantTime.equal` is property-tested to agree with byte equality. Fixtures carry a provenance README per [fixtures carry provenance](../conventions/fixtures-carry-provenance-readme.md).

## Consumers

- [`github-actions`](github-actions.md): `BlobStore.layerS3` signs with `SigV4`; `internal/sigv4.ts` is deleted.
- [`webhooks`](webhooks.md): every preset verifies through `Hmac` and `ConstantTime`.
- `savvy-web/build` intake: its S3 archive signs with `SigV4`, replacing `src/s3/SigV4.ts`, and its verifiers move onto `webhooks`.

[^owner]: conversation with the repository owner
[^core-crypto]: `../../.repos/effect/packages/effect/src/Crypto.ts`
[^actions-sigv4]: <https://github.com/spencerbeggs/effected/blob/e8990d4f/packages/github-actions/src/internal/sigv4.ts>
[^intake-sigv4]: <https://github.com/savvy-web/build/blob/main/intake/src/s3/SigV4.ts>
[^intake-hmac]: <https://github.com/savvy-web/build/blob/main/intake/src/vendors/hmac.ts>
