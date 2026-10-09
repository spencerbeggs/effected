# @effected/jwt

[![npm](https://img.shields.io/npm/v/@effected%2Fjwt?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/jwt)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)

JWS, JWT, JWK and JWKS sign and verify over WebCrypto, for Effect v4. It runs anywhere WebCrypto does, including Node, browsers and Cloudflare Workers, with no `node:` import and no runtime dependency beyond the `effect` peer.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `^4.0.0`) and still in `0.x` development.
>
> **Stability: unstable.** This package's API surface is not yet complete and may change across `0.x` releases. Pin an exact version. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
pnpm add @effected/jwt effect
```

All `@effected/*` packages are ESM-only.

## Status

The package is being built. The design lives in the repository at `okf/modules/jwt.md`: RS256 and ES256 only, the algorithm taken from the key and never the token header, private keys always `Redacted`, and a typed `JwtError` routed on its `reason`.
