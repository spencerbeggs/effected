---
"@effected/images": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest replaces Crypto

`ImageCacheKey.fromParams` now requires `Digest.Digest` (from `effect/crypto`) instead of `Crypto`, and `ImageCacheKeyError.reason` loses `"digest"`, which can no longer occur; a `case "digest"` stops compiling. The `./cache` entry is no longer satisfied by `NodeServices.layer` alone: add `NodeCrypto.layerDigest` beside it. Cache keys are byte-identical to before.
