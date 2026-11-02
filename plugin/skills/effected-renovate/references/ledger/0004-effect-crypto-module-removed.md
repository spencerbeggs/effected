---
id: "0004"
title: The effect root Crypto module is removed
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["(^|[^A-Za-z])Crypto\\.", "import [^;]*[{,] *Crypto *[,}][^;]*from \"effect\"", "effect/Crypto", "TestCrypto"]
---

`effect/Crypto` is gone. Randomness and UUIDs come from `SecureRandom`, hashing from `Digest` with algorithm values such as `Digest.sha256`, both under `effect/crypto`. `effect/testing/TestCrypto` is gone too: build doubles with `Layer.mock` for the services you need.

Crypto is no longer in the platform `*Services` bundles (`NodeServices` carries none), so provide it yourself at the edge: `NodeCrypto.layer` (every family) or a family layer such as `NodeCrypto.layerDigest` from `@effect/platform-node`, or core's `Digest.layerWebCrypto` on any WebCrypto runtime.

How it shows itself: an import of `Crypto` stops compiling, and a program that leaned on `NodeServices` for crypto gets a missing-service error naming `Digest` or `SecureRandom`. Core's `Digest` cannot fail with a typed error, so drop error handling that was only there for the digest. Without `crypto.subtle`, a SHA digest **dies** rather than failing. A published package built on 4.0.x that imports `Crypto` from `effect` dies at import on 4.1 (`does not provide an export named 'Crypto'`); that is entry 0003's case.

Check each replacement against the installed `effect/dist/crypto/*.d.ts`.
