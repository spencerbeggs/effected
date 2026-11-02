---
id: "0038"
title: Adopt effect/crypto for hashing, MACs, signatures and randomness
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["crypto\\.subtle", "from \"(node:)?crypto\"", "create(Hmac|Hash|Sign|Verify)\\(", "randomUUID\\("]
---

Core `effect/crypto` ships `Digest`, `SecureRandom`, `Mac`, `Signature`, `Aead`, `Cipher`, `Kdf`, `KeyAgreement`, `KeyWrap` and `KeyFormat`, each a service with a WebCrypto layer (`layerWebCrypto`) and, in `@effect/platform-node`, `NodeCrypto` layers. As services in `R`, they make a test double a `Layer.mock` rather than a stubbed global.

Where to look: direct `crypto.subtle` or `node:crypto` calls, and hand-written hash, HMAC or signature helpers. Replace one only where the semantics match. Where it computes something you persist or publish (a hash, a key, a signature), compare the output against your stored data first. Several modules are `@stability unstable`: read each in the installed `effect/dist/crypto/` before adopting it.
