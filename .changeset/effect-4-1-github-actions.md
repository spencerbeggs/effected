---
"@effected/github-actions": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest and SecureRandom replace Crypto

`BlobStore.layerS3` now requires `Digest.Digest`. `ActionServices` gains `Digest.Digest` and `SecureRandom.SecureRandom`, and `ActionRuntime.layer` provides both from `NodeCrypto`, so an action run through `Action.run` needs no change. A hand-composed `layerS3` must provide `Digest`.
