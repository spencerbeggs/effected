---
"@effected/crypto": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest replaces Crypto

Effect 4.1 removed the root `Crypto` service, so `SigV4.canonicalize`, `SigV4.sign` and `Fingerprint.of` now require `Digest.Digest` (from `effect/crypto`) in `R` where they required `Crypto`. They no longer fail with `PlatformError`, so a `catchTag("PlatformError")` on these effects stops compiling. `SigV4.signingKey` is unchanged. Provide `Digest.layerWebCrypto` (any WebCrypto runtime) or `NodeCrypto.layerDigest` from `@effect/platform-node`. Hashes are byte-identical to before.

### HMAC runs on core Mac, and core's CryptoError replaces this package's

Every HMAC now goes through core's `Mac.Mac` (from `effect/crypto`), required in `R`: `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual` and `SigV4.signingKey` require `Mac.Mac`, and `SigV4.sign` requires `Mac.Mac` beside `Digest.Digest`. Provide `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (any WebCrypto runtime) or `NodeCrypto.layerMac` from `@effect/platform-node`. Tags and SigV4 signatures are byte-identical to before.

* `CryptoError` and `CryptoErrorReason` are removed. The error channel is core's `CryptoError` from `effect/crypto`; its tag is still `"CryptoError"`, but `reason` is a tagged object (`InvalidKey` for an empty key) rather than the strings `"unsupportedRuntime"` and `"key"`.
* A runtime with no `crypto.subtle` no longer fails with `unsupportedRuntime`: on `Mac.layerWebCrypto` the HMAC dies, as a digest already did.
* `Hmac.verify` and `ConstantTime.secretsEqual` compare through `Mac.verify`, and `ConstantTime.equal` through `Mac.timingSafeEqual`; `ConstantTime.equal` still takes strings and needs nothing in `R`.
