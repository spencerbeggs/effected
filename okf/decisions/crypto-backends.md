---
type: Decision
title: Keyed operations come from WebCrypto, payload digests from core Crypto required in R
description: "@effected/crypto computes HMAC, and the keyed blinding of a shared-secret comparison, through globalThis.crypto.subtle, and every digest of a payload through core Crypto.digest required in R, rather than one backend for both or node:crypto."
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
    resource: ../../.repos/effect/packages/effect/src/Crypto.ts
    title: "Core Crypto at 4.0.6: a one-shot digest and random primitives, no HMAC"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-23T01:39:30Z
integrity:
  generated:
    body: 3e1bfd09f9be7055
  verified:
    by: human:spencer
    at: 2026-10-23T04:05:21Z
    content: d0981e77bf4ded27
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-10-23T04:05:21Z
---

# Keyed operations come from WebCrypto, payload digests from core Crypto required in R

## Context

[`@effected/crypto`](../modules/crypto.md) needs two kinds of primitive: keyed (HMAC, for SigV4, every webhook scheme, and blinding a shared secret before comparison) and unkeyed (SHA-256, for the SigV4 payload and canonical-request hashes). Core `Crypto` at 4.0.6 declares a one-shot `digest` and nothing keyed.[^core-crypto] Before this package, both SigV4 implementations reached for `node:crypto` for both kinds, which pinned them to Node.

## Decision

Every keyed operation is computed through `globalThis.crypto.subtle`, read directly with an `unsupportedRuntime` failure when absent, which is [`jwt`](../modules/jwt.md)'s precedent. That includes `ConstantTime.secretsEqual`: it MACs both sides under a fresh, non-extractable key from `subtle.generateKey` and compares the MACs, so it is a keyed operation core has no contract for, needs nothing in `R`, and fails only with `CryptoError`. Every digest of a payload goes through core `Crypto.digest`, required in `R`, so the application supplies the platform layer once at its edge, per [require core in R](../conventions/require-in-r-default.md).[^owner]

## Alternatives rejected

- **`node:crypto` for both.** Synchronous and familiar, but it puts the package off workerd and browsers, and the webhook verifiers are wanted in a Workers handler.
- **`crypto.subtle.digest` for both, one backend.** Simpler wiring and no `Crypto` in `R`, but it re-implements a contract core already declares, which is the failure [require core in R](../conventions/require-in-r-default.md) exists to stop, and it takes away a test's ability to substitute the digest.
- **Blinding a shared secret with core `Crypto.digest`.** The first shape: SHA-256 both sides, then compare. It put `Crypto` in `R` and `PlatformError` in `E` of `SharedSecret.verify` alone among the webhook presets, which cost the intake consumer a type parameter, a test layer in nine files and a hand-written `catchTag`. Blinding needs a key no one else holds, not a digest, so it belongs on the keyed side.
- **Wait for core HMAC.** Nothing in core's roadmap names it, and three call sites need it now.

## Consequences

Signing is asynchronous, so `SigV4.sign`, `Hmac.sign` and `ConstantTime.secretsEqual` return an `Effect`, and it is truly asynchronous: the fiber waits on a WebCrypto promise, so a test that forks one and then adjusts `TestClock` needs a latch. Only SigV4 needs `Crypto` in `R`: [`github-actions`](../modules/github-actions.md)' `BlobStore.layerS3` gains `Crypto` in its requirements, a public type change that `NodeServices.layer` already satisfies. A streamed digest stays outside both backends, since neither hashes a stream.

[^owner]: conversation with the repository owner
[^core-crypto]: `../../.repos/effect/packages/effect/src/Crypto.ts`
