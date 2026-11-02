---
id: "0032"
title: JWS and JWT signing and verifying require core's Signature service
kind: breaking
shows: typed
applies:
  "@effected/jwt": ">=0.8.0"
  "@effected/oidc": ">=0.3.0"
  "@effected/github": ">=0.27.0"
detect: ["(Jws|Jwt)\\.(sign|verify)", "JwtKey\\.generate", "TestIssuer", "(Actions)?Oidc\\.verify", "GitHubApp\\.(layer|layerWith|clientLayer|appClientLayer)[^A-Za-z]", "(SigningKey|VerificationKey|JoseHeader)", "key\\.alg[^A-Za-z]"]
---

`@effected/jwt` no longer carries its own WebCrypto engine: signing, verifying, key import, segment encoding, PKCS#1 conversion and the registered-claim checks run in core `effect/jose` and `effect/crypto`. Tokens interoperate both ways with the previous release, and a GitHub App JWT is byte-for-byte the token it was.

**What you provide.** Signing and verifying require core's `Signature` service. Provide it once at the edge: `Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto`. A program missing it gets a compile error naming `Signature`.

Per package:

- **`@effected/jwt`:** `Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate` and `TestIssuer` (`make`, `rotate`, a test issuer's `sign`) require `Signature.Signature`. `JwtKey.fromPkcs8Pem`, `JwtKey.fromJwk`, `Jws.decodeUnverified` and `JwksResolver` need nothing new.
- **`@effected/jwt` key types:** `SigningKey` and `VerificationKey` are now types, not classes: core's `Jwk.PrivateKey` and `Jwk.PublicKey`. `key.alg` becomes `key.algorithm`, and `key.key` is core's `Signature` key, not a `CryptoKey`; code that called `crypto.subtle` with it signs through the `Signature` service instead. `JoseHeader` is core's `Jws.ProtectedHeader`. `JwtErrorReason` loses `"unsupportedRuntime"`, so a `case "unsupportedRuntime"` stops compiling.
- **`@effected/oidc`:** `Oidc.verify` requires `Signature.Signature` beside `JwksResolver`. `Oidc.decodeUnverified` needs nothing, and now requires a JSON-object payload.
- **`@effected/github`:** `GitHubApp.layer`, `layerWith`, `clientLayer` and `appClientLayer` require `Signature.Signature`; `ActionsOidc.verify` requires it beside `JwksResolver`. The `GitHubApp` methods do not, because the layer captures the service when built. `GitHubApp.layerTest` and `makeTest` are unchanged.
- **`@effected/github-actions`** has no `R` change: it reads tokens only through the `decodeUnverified` functions.

New and additive: every asymmetric algorithm core has (`RS`/`PS`/`ES` 256 to 512, `EdDSA`), `kty: "OKP"` JWKs, and PKCS#1 for `PS*`. A header without `kid` now matches when exactly one key in the set fits its algorithm.

**Test doubles:** a test that stubbed `globalThis.crypto` to make a later signing fail no longer can, because core's `Signature` layer captures WebCrypto when built; wrap the real `Signature` service and fail its `sign` instead. In `@effect/vitest`, provide `Signature` with `layer(CryptoLive, { buildPerTest: true })`: a block-level `layer(...)` builds once, so its tests share one `TestClock`, and a test that sets the time breaks the next.

The error-routing changes are entry 0033. Check each signature against the package's installed `.d.ts` and `effect/dist/jose/*.d.ts`.
