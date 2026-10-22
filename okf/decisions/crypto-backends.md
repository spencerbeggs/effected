---
type: Decision
title: HMAC comes from WebCrypto, digests from core Crypto required in R
description: "@effected/crypto computes HMAC through globalThis.crypto.subtle and every digest through core Crypto.digest required in R, rather than one backend for both or node:crypto."
status: draft
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
  at: 2026-10-22T23:55:11Z
integrity:
  generated:
    body: 21f58dc984da4a79
---

# HMAC comes from WebCrypto, digests from core Crypto required in R

## Context

[`@effected/crypto`](../modules/crypto.md) needs two kinds of primitive: keyed (HMAC, for SigV4 and every webhook scheme) and unkeyed (SHA-256, for the SigV4 payload hash and for hashing a shared secret before comparison). Core `Crypto` at 4.0.6 declares a one-shot `digest` and nothing keyed.[^core-crypto] Before this package, both SigV4 implementations reached for `node:crypto` for both kinds, which pinned them to Node.

## Decision

HMAC is computed through `globalThis.crypto.subtle`, read directly with an `unsupportedRuntime` failure when absent, which is [`jwt`](../modules/jwt.md)'s precedent. Every digest goes through core `Crypto.digest`, required in `R`, so the application supplies the platform layer once at its edge, per [require core in R](../conventions/require-in-r-default.md).[^owner]

## Alternatives rejected

- **`node:crypto` for both.** Synchronous and familiar, but it puts the package off workerd and browsers, and the webhook verifiers are wanted in a Workers handler.
- **`crypto.subtle.digest` for both, one backend.** Simpler wiring and no `Crypto` in `R`, but it re-implements a contract core already declares, which is the failure [require core in R](../conventions/require-in-r-default.md) exists to stop, and it takes away a test's ability to substitute the digest.
- **Wait for core HMAC.** Nothing in core's roadmap names it, and three call sites need it now.

## Consequences

Signing is asynchronous, so `SigV4.sign` and `Hmac.sign` return an `Effect`. A caller that signs needs `Crypto` in `R`: [`github-actions`](../modules/github-actions.md)' `BlobStore.layerS3` gains `Crypto` in its requirements, a public type change that `NodeServices.layer` already satisfies. A streamed digest stays outside both backends, since neither hashes a stream.

[^owner]: conversation with the repository owner
[^core-crypto]: `../../.repos/effect/packages/effect/src/Crypto.ts`
