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
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T22:29:55Z
  body_sha256: 08604814e92cfa390bfa6c02515716179501525b0a15473a0d32d5340cb74ae6
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

`./testing` exports `TestIssuer`, a generated key pair with a signer and a JWKS document for tests. It names root types through a type-only self-reference, the `cli` and `jsonl` pattern, with `dtsExternals` set. The bundler's second API Extractor pass resolves that self-reference into `src`, so the build carries narrow suppressions and an accepted warning; the same shape is described for [`@effected/images`](images.md) and in [the self-reference gotcha](../gotchas/self-reference-api-extractor-pass-looks-clean-when-it-crashes.md). The exact suppression list is settled when the entrypoint is built. Whether a second entrypoint is warranted follows [the measured-cost rule](../decisions/second-published-entrypoint.md).

## Consumers

[`@effected/github`](github.md) takes a regular dependency on this package for GitHub App authentication and Actions OIDC verification. The first external consumer is savvy-web/silk-app. The issues driving the work are 768 (the two JWT halves), 970 (the installation token store), 975 (additive `Installation` fields) and 827 (`GitHubError.fromResponse`).
