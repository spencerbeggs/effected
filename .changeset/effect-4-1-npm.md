---
"@effected/npm": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Digest replaces Crypto

`PackageTarball.layer` and `PackagePublish.layer` now require `Digest.Digest` (from `effect/crypto`) where they required `Crypto`. `TarballError.reason` loses `"integrityUnverifiable"`: a digest that cannot be computed is now a defect rather than a typed failure. It is still never reported as an integrity mismatch, and the bytes still never reach `tar`. Provide `Digest.layerWebCrypto` or `NodeCrypto.layerDigest`.
