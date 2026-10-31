---
"@effected/jwt": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

Signing, verifying and key generation now run on core `effect/jose` and `effect/crypto` instead of the package's own WebCrypto engine. They require core's `Signature` service: `Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate`, `TestIssuer.make`, `TestIssuer.rotate` and a test issuer's `sign` all gain `Signature` in `R`. Provide it once at the edge:

```ts
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

* `SigningKey` and `VerificationKey` are now types, not classes: they are core's `Jwk.PrivateKey` and `Jwk.PublicKey`. Read the algorithm from `key.algorithm` (was `key.alg`); `key.key` is core's `Signature` key, not a `CryptoKey`. A key from `JwtKey` now works with core `Jws` and `Jwt` directly.
* `JoseHeader` is core's `Jws.ProtectedHeader`: `alg` must be an algorithm core knows, and every member must be JSON.
* The `unsupportedRuntime` reason is removed from `JwtErrorReason`.
* `alg: "none"`, or any algorithm core does not know, is now `malformed` (was `unsupportedAlgorithm`). HMAC algorithms are still `unsupportedAlgorithm`, and neither resolves a key.
* `Jws.decodeUnverified` requires a JSON-object payload.
* In a resolved key set, a key whose `use` is not `sig` never matches, so it is now `unknownKid` (was `key`). A token without `kid` matches when exactly one key fits its algorithm, not only when the set holds one key, and a `kid` matching several keys is `unknownKid`.
* `Jwt.verify` checks claims in core's order: `iss` and `aud` before `exp` and `nbf`, then a future `iat` after the payload schema. A token failing several checks can report a different reason. Time is compared in whole seconds.
* `JwtError.detail` text is core's wording where core produced the failure.

## Features

* Every asymmetric algorithm core implements is supported: `RS256`-`RS512`, `PS256`-`PS512`, `ES256`-`ES512` and `EdDSA` (Ed25519). `JwtAlgorithm` widens to match, `Jwk` accepts `kty: "OKP"`, and `fromPkcs8Pem` reads PKCS#1 for `PS*` as well as `RS*`.
* `JwksResolver` imports each key of a fetched set once, instead of once per verification.
