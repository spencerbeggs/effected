---
id: "0029"
title: Kit HMAC moves onto core Mac
kind: breaking
shows: typed
applies:
  "@effected/crypto": ">=0.4.0"
  "@effected/webhooks": ">=0.3.0"
  "@effected/github-actions": ">=0.30.0"
detect: ["Hmac\\.(sign|verify)", "ConstantTime\\.secretsEqual", "SigV4\\.(sign|signingKey)", "(GitHub|Stripe|StandardWebhooks|Sanity|HmacHeader|SharedSecret)\\.verify", "BlobStore\\.layerS3"]
---

`@effected/crypto` no longer reads `crypto.subtle` itself: every HMAC, the keyed blinding in `ConstantTime.secretsEqual` and SigV4's signing-key derivation go through core's `Mac.Mac` (`import { Mac } from "effect/crypto"`), required in `R`. Tags are byte-identical to before (RFC 4231 and AWS's SigV4 examples pass unchanged).

**What you provide.** Add a `Mac` layer beside your `Digest` layer: `Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` on any WebCrypto runtime (Workers included), or `@effect/platform-node`'s `NodeCrypto.layerMac`, which needs nothing further. `NodeServices.layer` carries neither.

Per package:

- **`@effected/crypto`:** `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual` and `SigV4.signingKey` require `Mac.Mac`; `SigV4.sign` requires `Mac.Mac | Digest.Digest`. `ConstantTime.equal` stays pure. The error type changed too (entry 0030).
- **`@effected/webhooks`:** every preset's `verify` (`GitHub`, `Stripe`, `StandardWebhooks`, `Sanity`, `HmacHeader`, `SharedSecret`) requires `Mac.Mac`. The error channel is unchanged (`WebhookVerificationError` alone). `Webhooks.checkFreshness` needs nothing.
- **`@effected/github-actions`:** `BlobStore.layerS3` requires `Mac.Mac` beside `Digest.Digest`. `ActionServices` gains `Mac.Mac` and `ActionRuntime.layer` provides it, so an action run through `Action.run` needs no change; a hand-composed `layerS3` must provide `Mac`. A signing failure is still `BlobStoreError` `misconfigured`, its cause now core's `CryptoError`.

**Test doubles:** a test that spied on `crypto.subtle.generateKey` wraps the real `Mac` service instead. `@effect/vitest`'s `layer(...)` memoizes `Mac.layerWebCrypto` by reference, so a variant built from it inside such a suite needs `Layer.fresh`.

How it shows itself: compile errors naming `Mac`. Check each signature against the package's installed `.d.ts`.
