# @effected/oidc

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
