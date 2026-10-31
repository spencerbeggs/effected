# @effected/oidc

## 0.3.0

### Breaking Changes

- Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

- `Oidc.verify` now verifies on core `effect/jose` through `@effected/jwt`, and requires core's `Signature` service alongside `JwksResolver`:

```ts
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

- `Oidc.decodeUnverified` needs no service, and now requires the payload to be a JSON object. The `JwtError` reasons it and `Oidc.verify` fail with follow `@effected/jwt`'s: `alg: "none"` is `malformed`, and claims are checked in core's order. [#1168][#1168]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jwt | dependency | updated | 0.7.0 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jwt | dependency | updated | 0.6.0 | 0.7.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.0.7 [#1145][#1145]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1145]: https://github.com/spencerbeggs/effected/pull/1145

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jwt | dependency | updated | 0.5.0 | 0.6.0 |

## 0.1.1

### Other

- Patch release to verify OIDC publishing with GitHub.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

#### New package: `@effected/oidc`

- The OIDC identity-token contract and verification, with no provider baked in. It carries the `IdentityToken` service (with `IdentityTokenError` and `IdentityTokenShape`) that an issuer implements, the `IdTokenClaims` schema for the standard ID-token claims, and the `Oidc` module:

- `Oidc.decodeUnverified` splits a JWT and decodes its payload through a claims schema you supply, without checking the signature. Use it only where verification happens elsewhere.

- `Oidc.verify` verifies the signature and standard claims against the keys the issuer publishes through OIDC discovery, and refuses an empty audience.

- `IdentityToken` and its error type moved here from `@effected/sbom`. [#1051][#1051]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1051]: https://github.com/spencerbeggs/effected/pull/1051
