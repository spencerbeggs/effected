---
type: Module
title: "@effected/jwt"
description: Signed-token primitives (JWS, JWT, JWK, JWKS) over WebCrypto that run anywhere WebCrypto does, including Cloudflare workerd.
status: draft
kind: package
resource: ../../packages/jwt
layer: L1
tags:
  - architecture
  - security
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-09T00:00:00Z
  - id: core-crypto
    resource: ../../.repos/effect/packages/effect/src/Crypto.ts
    title: "Core Crypto: random bytes, digests and ids, and no sign, verify or importKey"
  - id: eventlog-session-auth
    resource: ../../.repos/effect/packages/effect/src/eventlog/EventLogSessionAuth.ts
    title: "Core's precedent for reading globalThis.crypto.subtle and failing when it is absent"
  - id: build
    resource: ../../packages/jwt/savvy.build.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T23:30:35Z
  body_sha256: 769c915ccdd553b22519123d365652d6aedd4c8951c98526358f6bed1a4f8ced
---

# `@effected/jwt`

`@effected/jwt` signs and verifies compact JWS tokens and validates JWT claims, imports signing and verification keys, and resolves verification keys from a remote JWKS. It exists because the kit's GitHub App authentication and GitHub Actions OIDC verification both need one shared token vocabulary, and because [core `Crypto` offers no sign, verify or importKey](#core-owned-list). The placement of those consumers is settled in [App auth lands in `@effected/github`](../decisions/app-auth-lands-in-github.md); how a key chooses its algorithm is settled in [the algorithm comes from the key](../decisions/jwt-algorithm-from-key.md).

## Tier and dependencies

Boundary tier, which runs anywhere WebCrypto does: Node, browsers and Cloudflare workerd. There is no `node:` import under `src/`, because the consumer that motivated the package is a Cloudflare Workers GitHub App (savvy-web/silk-app) with no `node:crypto`. There are no runtime dependencies, and `peerDependencies` is `effect` alone.

The package reads `globalThis.crypto?.subtle` directly. Core `Crypto` (verified against the vendored source on 2026-10-09) offers random bytes, SHA-1/256/384/512 digests, random numbers, UUIDv4/v7 and ULID, and nothing else. Core's own `eventlog/EventLogSessionAuth.ts` reads `globalThis.crypto?.subtle` for Ed25519 sign and verify, and that is the precedent this package follows. When `subtle` is absent the package fails with `JwtError` and `reason: "unsupportedRuntime"`.

## Core-owned list

Nothing here is re-derived from core. Base64url is `effect/encoding/Base64Url` (`encode`, `decode`, `decodeString`) and base64 is `effect/encoding/Base64`. Digests and random bytes are core `Crypto`, and this package needs neither. HTTP is `effect/http`, caching primitives are core `Cache` and `ScopedCache`, and time is `Clock`, never `Date.now()`. Core has no JWS, JWK, sign, verify or importKey surface, so those are this package's job and nothing else is.

## Modules

| File | Responsibility |
| --- | --- |
| `src/JwtError.ts` | the one tagged error, with its `reason` union |
| `src/internal/subtle.ts` | `subtle` acquisition, the `unsupportedRuntime` failure, `Uint8Array` to `ArrayBuffer` |
| `src/internal/segments.ts` | compact-JWS split and join over core `Base64Url` |
| `src/internal/der.ts` | PEM armour strip and the PKCS#1 to PKCS#8 DER wrap |
| `src/Jwk.ts` | `Jwk` and `Jwks` schemas |
| `src/JwtKey.ts` | `SigningKey` and `VerificationKey` and the importers (`fromPkcs8Pem`, `fromJwk`, `generate`) |
| `src/Jws.ts` | `Jws.sign`, `Jws.verify` and `Jws.decodeUnverified` |
| `src/Jwt.ts` | `RegisteredClaims`, `Jwt.sign` and `Jwt.verify` with claim validation |
| `src/JwksStore.ts` | the cache seam with its memory layer |
| `src/JwksResolver.ts` | discovery, then JWKS, then a key by `kid`, with a rate-limited refetch |
| `src/index.ts` | root entrypoint |
| `src/testing.ts` | `TestIssuer`, the `./testing` entrypoint |

The package follows the [module-per-concept layout](../conventions/module-per-concept-layout.md): one `src/<Concept>.ts` per exported concept and only the entrypoints re-export.

## Behaviour

- Algorithms are `RS256` and `ES256` (P-256). `alg: "none"` is never accepted. The algorithm comes from the key, never the token header; a header `alg` that differs from the key's fails as `algorithmMismatch` and no other algorithm is attempted. This closes key confusion, such as an `HS256` token verified against an RSA public key.
- `JwtError.reason` is exactly `malformed`, `unsupportedAlgorithm`, `algorithmMismatch`, `badSignature`, `unknownKid`, `expired`, `notYetValid`, `wrongIssuer`, `wrongAudience`, `claims`, `key`, `jwksFetch` or `unsupportedRuntime`. Consumers route on `reason`, never on `message`.
- Private key material is always `Redacted`, and `Redacted.value` is read only at the import call.
- A PKCS#1 (`BEGIN RSA PRIVATE KEY`) key, which is what github.com hands out for an App, is accepted by wrapping it into PKCS#8 DER, so it works on workerd too.
- Default clock tolerance is 60 seconds, configurable as a `Duration`, and time is read from `Clock` so `TestClock` drives it. An `aud` array containing the expected audience among others is accepted; an absent `aud` when one was required is `wrongAudience`.
- A JWKS rotation (a `kid` absent from the cached set) triggers one refetch and then success. A second unknown `kid` within the refetch interval is `unknownKid` with no further fetch.

## The testing entrypoint

`./testing` exports `TestIssuer`: a generated key pair with a signer, and an in-memory `HttpClient` serving the issuer's discovery document and JWKS, so a consumer test verifies through the real `JwksResolver` with no network. `TestIssuer.rotate` adds a key under a new `kid`, served alongside the earlier ones; the resolver's refetch interval still applies, so a test under `TestClock` advances it before verifying with the new key. The issuer must be `https:` or a localhost `http:` URL, because the resolver refuses any other.

`src/TestIssuer.ts` names root types through a type-only `import type * as Root from "@effected/jwt"` self-reference and imports runtime values relatively, the [`@effected/images`](images.md) pattern, with `dtsExternals` set. The build emits one module per source file, so `TestIssuer` uses the root's own classes rather than copies. The bundler's second API Extractor pass resolves the self-reference into `src`, and the build settles as images does, per [the self-reference gotcha](../gotchas/self-reference-api-extractor-pass-looks-clean-when-it-crashes.md): one accepted `ae-wrong-input-file-type` warning, left unsuppressed.[^build]

The suppression list in `savvy.build.ts` is exactly two entries, both `ae-forgotten-export`:

- the house `_base` pattern, for the heritage types Effect's class factories synthesize;
- the self-reference names, matched only for `testing.d.ts`: `Root` itself and the sixteen root symbols `TestIssuer`'s signatures reach transitively (`CachedJwks`, `DecodedJws`, `JoseHeader`, `Jwk`, `Jwks`, `JwksResolver`, `JwksResolverOptions`, `JwksResolverShape`, `JwksStore`, `JwksStoreShape`, `JwtAlgorithm`, `JwtError`, `JwtErrorReason`, `SigningKey`, `VerificationKey`, `VerifyOptions`), every one exported by the root entry point.

Dropping any name from the second pattern brings its warning back, so a genuinely forgotten export from either entry point still fails the build. Whether a second entrypoint is warranted follows [the measured-cost rule](../decisions/second-published-entrypoint.md).

## Consumers

[`@effected/github`](github.md) takes a regular dependency on this package for GitHub App authentication and Actions OIDC verification. The first external consumer is savvy-web/silk-app. The issues driving the work are 768 (the two JWT halves), 970 (the installation token store), 975 (additive `Installation` fields) and 827 (`GitHubError.fromResponse`).

[^build]: `packages/jwt/savvy.build.ts`, whose comments state the suppression's scope; the warning itself is in `packages/jwt/dist/prod/issues.json` after a build.
