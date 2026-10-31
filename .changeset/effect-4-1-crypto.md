---
"@effected/crypto": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest replaces Crypto

Effect 4.1 removed the root `Crypto` service, so `SigV4.canonicalize`, `SigV4.sign` and `Fingerprint.of` now require `Digest.Digest` (from `effect/crypto`) in `R` where they required `Crypto`. They no longer fail with `PlatformError`, so a `catchTag("PlatformError")` on these effects stops compiling. `SigV4.signingKey` is unchanged. Provide `Digest.layerWebCrypto` (any WebCrypto runtime) or `NodeCrypto.layerDigest` from `@effect/platform-node`. Hashes are byte-identical to before.
