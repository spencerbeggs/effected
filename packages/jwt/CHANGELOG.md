# @effected/jwt

## 0.8.0

### Breaking Changes

- Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

- Signing, verifying and key generation now run on core `effect/jose` and `effect/crypto` instead of the package's own WebCrypto engine. They require core's `Signature` service: `Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate`, `TestIssuer.make`, `TestIssuer.rotate` and a test issuer's `sign` all gain `Signature` in `R`. Provide it once at the edge:

```ts
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

- `SigningKey` and `VerificationKey` are now types, not classes: they are core's `Jwk.PrivateKey` and `Jwk.PublicKey`. Read the algorithm from `key.algorithm` (was `key.alg`); `key.key` is core's `Signature` key, not a `CryptoKey`. A key from `JwtKey` now works with core `Jws` and `Jwt` directly.
- `JoseHeader` is core's `Jws.ProtectedHeader`: `alg` must be an algorithm core knows, and every member must be JSON.
- The `unsupportedRuntime` reason is removed from `JwtErrorReason`.
- `alg: "none"`, or any algorithm core does not know, is now `malformed` (was `unsupportedAlgorithm`). HMAC algorithms are still `unsupportedAlgorithm`, and neither resolves a key.
- `Jws.decodeUnverified` requires a JSON-object payload.
- In a resolved key set, a key whose `use` is not `sig` never matches, so it is now `unknownKid` (was `key`). A token without `kid` matches when exactly one key fits its algorithm, not only when the set holds one key, and a `kid` matching several keys is `unknownKid`.
- `Jwt.verify` checks claims in core's order: `iss` and `aud` before `exp` and `nbf`, then a future `iat` after the payload schema. A token failing several checks can report a different reason. Time is compared in whole seconds.
- `JwtError.detail` text is core's wording where core produced the failure.

### Features

- Every asymmetric algorithm core implements is supported: `RS256`-`RS512`, `PS256`-`PS512`, `ES256`-`ES512` and `EdDSA` (Ed25519). `JwtAlgorithm` widens to match, `Jwk` accepts `kty: "OKP"`, and `fromPkcs8Pem` reads PKCS#1 for `PS*` as well as `RS*`.
- `JwksResolver` imports each key of a fetched set once, instead of once per verification. [#1168][#1168]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.3.0 | 0.4.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.7.0

### Bug Fixes

#### Security

- The `JwtError` `jwksFetch` cause keeps a redacted copy of the request, so no credential is readable from a failed JWKS fetch. `@effected/jwt` now depends on `@effected/crypto`. [#1151][#1151]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.2.1 | 0.3.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.0.7 [#1145][#1145]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1145]: https://github.com/spencerbeggs/effected/pull/1145

[#1151]: https://github.com/spencerbeggs/effected/pull/1151

## 0.6.0

### Breaking Changes

#### Class form

- `Jws`, `Jwt`, `JwtKey` and `TestIssuer` (from `@effected/jwt/testing`) are now classes with a private constructor and static members instead of typed const objects. Call shapes and `Object.keys` are unchanged. What a caller can observe:

- `typeof` is `"function"` instead of `"object"`, and `JSON.stringify` returns `undefined` instead of `"{}"`.

- `typeof Jws` and the others are class-constructor types, so a hand-built object double typed as one no longer type-checks.

### Bug Fixes

- `JwksResolver` maps a non-UTF-8 JWKS body and a discovered `jwks_uri` that is not a URL through `Effect.try`, with the same `reason`, `detail` and `cause` as before. [#1066][#1066]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1066]: https://github.com/spencerbeggs/effected/pull/1066

## 0.5.0

### Maintenance

- Upgrades core Effect library dependencies to v4.0.6 [#1039][#1039]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1039]: https://github.com/spencerbeggs/effected/pull/1039

## 0.4.0

### Maintenance

- Upgrades core Effect library dependencies to v4.0.5 [#1019][#1019]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1019]: https://github.com/spencerbeggs/effected/pull/1019

## 0.3.0

### Maintenance

- Upgrades core Effect library dependencies to v4.0.4 [#1008][#1008]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1008]: https://github.com/spencerbeggs/effected/pull/1008

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.2 | ^4.0.3 |

- Effect 4.0.3 advance: the `effect` peer and catalog move from the exact `4.0.2` hold back to `^4.0.3`. No API change. [#1000][#1000]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1000]: https://github.com/spencerbeggs/effected/pull/1000

## 0.1.1

### Bug Fixes

- Republished with every `effect` and `@effect/*` version pinned exactly to `4.0.2`, both peer and dependency ranges.

- On 2026-10-10, every `@effect/*` package published at `4.0.3`, but `effect@4.0.3` itself never reached npm (Effect-TS/effect#8994). The 4.0.3 packages require `effect ^4.0.3`. A caret range on any of them therefore resolves a 4.0.3 package next to `effect@4.0.2`, and the program crashes when it imports them. Exact pins keep a fresh install of any kit package on a matched set until `effect@4.0.3` is available. [#997][#997]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#997]: https://github.com/spencerbeggs/effected/pull/997

## 0.1.0

### Features

#### JWS, JWT, JWK and JWKS over WebCrypto

- `@effected/jwt` signs and verifies JSON Web Signatures and Tokens, models JSON Web Keys, and resolves keys from a JWKS endpoint. It is built on WebCrypto with no `node:` imports, so it runs on Node and on Cloudflare workerd.

- RS256 and ES256 are the supported algorithms, and the algorithm is taken from the key rather than from the token header.

- A token whose `alg` is outside that set is refused before any key is resolved, and a token carrying `crit` is refused.

- RSA keys must be at least 2048 bits and EC keys must be P-256.

- PEM keys are accepted as PKCS#1 or PKCS#8, including PEM text whose line breaks arrive as escaped `\n`.

- Every failure is a single `JwtError` with a `reason` you can route on.

#### Key resolution with `JwksResolver`

- `JwksResolver` fetches and caches a remote key set and selects the key for a token.

- Storage goes through the `JwksStore` seam, so the cache can live in memory or in a store you provide.

- Entries honour a TTL, refetches are rate-limited, and the fetch has a timeout.

- Discovery is https-only.

#### Test issuer at `@effected/jwt/testing`

- `TestIssuer` mints keys and signed tokens, and serves a matching key set, so tests can exercise verification without a network or a real identity provider. [#984][#984]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#984]: https://github.com/spencerbeggs/effected/pull/984
