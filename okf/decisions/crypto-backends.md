---
type: Decision
title: Keyed operations come from core Mac, payload digests from core Digest, both required in R
description: "@effected/crypto computes HMAC, the keyed blinding of a shared-secret comparison and SigV4 key derivation through core Mac.Mac, and every digest of a payload through core Digest.Digest (effect/crypto), both required in R, rather than reading crypto.subtle itself or node:crypto."
status: stable
tags:
  - architecture
  - security
  - compat
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: core-crypto
    resource: ../../.repos/effect/packages/effect/src/crypto/index.ts
    title: "Core effect/crypto: Digest and SecureRandom, and the keyed Mac, Signature, Cipher, Aead, Kdf, KeyAgreement and KeyWrap services"
  - id: core-mac
    resource: ../../.repos/effect/packages/effect/src/crypto/Mac.ts
    title: "Mac.Mac: generateKey, sign and a constant-time verify; Mac.key refuses an empty key with InvalidKey; layerWebCrypto dies without crypto.subtle"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-31T19:37:34Z
integrity:
  generated:
    body: caa1f9ae4fbc71b5
  verified:
    by: human:spencer
    at: 2026-10-31T19:39:48Z
    content: 2597ee89125a7d6f
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-10-23T04:05:21Z
  - by: human:spencer
    at: 2026-10-25T20:04:29Z
  - by: human:spencer
    at: 2026-10-28T14:29:17Z
  - by: human:spencer
    at: 2026-10-31T19:39:48Z
---

# Keyed operations come from core Mac, payload digests from core Digest, both required in R

## Context

[`@effected/crypto`](../modules/crypto.md) needs two kinds of primitive: keyed (HMAC, for SigV4, every webhook scheme, and blinding a shared secret before comparison) and unkeyed (SHA-256, for the SigV4 payload and canonical-request hashes). When the package was first built, core's `Crypto` declared a one-shot `digest` and nothing keyed, so HMAC read `globalThis.crypto.subtle` directly, failing with the package's own `CryptoError` (`unsupportedRuntime`) when it was absent, which was [`jwt`](../modules/jwt.md)'s precedent. Core's `effect/crypto` now declares both halves: `Digest` for digests, and `Mac` for HMAC with SHA-1, SHA-256, SHA-384 or SHA-512, with `generateKey`, `sign`, a constant-time `verify`, and `timingSafeEqual`.[^core-crypto][^core-mac] Before this package, both SigV4 implementations reached for `node:crypto` for both kinds, which pinned them to Node.

## Decision

Every keyed operation goes through core `Mac.Mac`, and every digest of a payload through core `Digest.Digest`, both required in `R`, so the application supplies the platform layers once at its edge, per [require core in R](../conventions/require-in-r-default.md). As Effect gains a capability, the kit trims what it no longer needs.[^owner] Concretely:

- `Hmac.sign` and `Hmac.verify` build a key with `Mac.key` and sign or verify with the service; `verify` is `Mac.verify`, never a hand-rolled compare. What the kit keeps is the shape core lacks: `Redacted` keys, string and multi-part messages, hex and base64 output, and a received signature that does not decode answering `false`.
- `ConstantTime.secretsEqual` blinds with `Mac.generateKey(Mac.hmacSha256)`, signs the expected side and checks the received side with `Mac.verify`. `ConstantTime.equal` is core's `Mac.timingSafeEqual` over UTF-8 bytes.
- SigV4's signing-key derivation runs its four HMACs through `Mac`, so `SigV4.sign` requires `Mac.Mac` beside `Digest.Digest`.
- The error channel is core's `CryptoError` (`effect/crypto`). The package's own `CryptoError`, and the internal `crypto.subtle` acquisition behind it, are deleted, and core's is not re-exported under the kit's name.

## Alternatives rejected

- **`node:crypto` for both.** Synchronous and familiar, but it puts the package off workerd and browsers, and the webhook verifiers are wanted in a Workers handler.
- **`crypto.subtle` read directly for the keyed side.** The previous shape. It needed nothing in `R` and failed typed (`unsupportedRuntime`) without `crypto.subtle`, but it re-implemented a contract core now declares, kept a second constant-time loop and a second crypto error type in the kit, and took away a test's ability to substitute the MAC.
- **`crypto.subtle.digest` for digests, one backend.** Simpler wiring, but the same objection: it re-implements `Digest`.
- **Blinding a shared secret with a digest.** The first shape: SHA-256 both sides, then compare. Blinding needs a key no one else holds, not a digest, so it uses `Mac` with a fresh generated key.

## Consequences

`Hmac`, `ConstantTime.secretsEqual`, `SigV4.signingKey`, `SigV4.sign` and every [`webhooks`](../modules/webhooks.md) preset require `Mac.Mac`; SigV4 and `Fingerprint` require `Digest.Digest`. A consumer provides `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (any WebCrypto runtime, Workers included) or `@effect/platform-node`'s `NodeCrypto.layerMac`, which needs nothing further. Core's `Mac.layerWebCrypto` is truly asynchronous, so a test that forks one of these and then adjusts `TestClock` needs a latch. On the WebCrypto layers a runtime with no `crypto.subtle` now **dies** where the old keyed path failed typed; that is the same trade the kit accepted for `Digest`, and both are wiring defects a caller would `orDie` anyway. A refused key is core's `CryptoError` with reason `InvalidKey` (an empty HMAC key, for instance). [`github-actions`](../modules/github-actions.md)' `BlobStore.layerS3` requires both services, which `NodeServices.layer` does not carry; `ActionRuntime.layer` provides them from `NodeCrypto` (`layerDigest`, `layerMac`). A streamed digest stays outside both services, since neither hashes a stream.

## Out of scope: nonce randomness

This decision covers keyed operations and digests. It does not cover drawing random bytes, which core `SecureRandom` declares (`randomBytes`) and which [require core in R](../conventions/require-in-r-default.md) therefore sends to `R`. The one place the kit draws random bytes from WebCrypto instead, [`config-file`](../modules/config-file.md)'s AES-GCM IV, is a separately recorded, security-motivated exception for nonces (a swappable random source can repeat a GCM nonce), not an application of this decision.

[^owner]: conversation with the repository owner
[^core-crypto]: `.repos/effect/packages/effect/src/crypto/index.ts`
[^core-mac]: `.repos/effect/packages/effect/src/crypto/Mac.ts`
