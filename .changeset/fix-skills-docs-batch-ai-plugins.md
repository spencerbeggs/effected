---
"@effected/ai-plugins": patch
---

## Documentation

- The `effect-v4-testing`, `effected-packages` and `effect-v4-module-index` skills now say that `NodeServices.layer` provides no crypto service, `Digest` included, and that a program or test that hashes composes `NodeCrypto.layerDigest` (or core's `Digest.layerWebCrypto`) beside it. The `mcp-kit` reference no longer claims `NodeServices.layer` bundles crypto.
- The `release-and-publish` and `effect-v4-idioms` skills now treat narrowing a public error type as a breaking change: `Effect.catchTag` and `Effect.catchTags` only accept tags in the error union, so a caller's handler for a removed error stops compiling. Ship it as a minor on `0.x`, and tell callers to delete the dead handler.
