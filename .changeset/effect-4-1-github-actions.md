---
"@effected/github-actions": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest, Mac and SecureRandom replace Crypto

`BlobStore.layerS3` now requires `Digest.Digest` and `Mac.Mac` (both from `effect/crypto`): SigV4 signing takes its HMACs from core's `Mac`. `ActionServices` gains `Digest.Digest`, `Mac.Mac` and `SecureRandom.SecureRandom`, and `ActionRuntime.layer` provides all three from `NodeCrypto`, so an action run through `Action.run` needs no change. A hand-composed `layerS3` must provide `Digest` and `Mac`. A request that cannot be signed still fails as `BlobStoreError` `misconfigured`; its cause is now core's `CryptoError`.
