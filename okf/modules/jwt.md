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
    resource: ../../.repos/effect/packages/effect/src/crypto/index.ts
    title: "Core effect/crypto: Digest, SecureRandom and keyed services, Signature, Mac and KeyFormat among them"
  - id: eventlog-session-auth
    resource: ../../.repos/effect/packages/effect/src/eventlog/EventLogSessionAuth.ts
    title: "Core's precedent for reading globalThis.crypto.subtle and failing when it is absent"
  - id: build
    resource: ../../packages/jwt/savvy.build.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T19:37:34Z
integrity:
  generated:
    body: 29abe0f9a36a06a9
---

# `@effected/jwt`

`@effected/jwt` signs and verifies compact JWS tokens and validates JWT claims, imports signing and verification keys, and resolves verification keys from a remote JWKS. It exists because the kit's GitHub App authentication and GitHub Actions OIDC verification both need one shared token vocabulary. It is now a thin layer over core `effect/jose` (`Jws`, `Jwt`, `Jwk`, `Jwks`, `JoseError`) and, beneath it, `effect/crypto`'s `Signature` and `KeyFormat`: core does every signature, key import, segment codec and registered-claim check, and [what remains here](#kit-only-residue) is what core does not provide. The placement of those consumers is settled in [App auth lands in `@effected/github`](../decisions/app-auth-lands-in-github.md); how a key chooses its algorithm is settled in [the algorithm comes from the key](../decisions/jwt-algorithm-from-key.md).

## Tier and dependencies

Boundary tier, which runs anywhere WebCrypto does: Node, browsers and Cloudflare workerd. There is no `node:` import under `src/`, because the consumer that motivated the package is a Cloudflare Workers GitHub App (savvy-web/silk-app) with no `node:crypto`. Its one runtime dependency is `@effected/crypto`, which is also WebCrypto-only and has no `node:` import, so the package still runs on workerd; it supplies `HttpRedaction`, through which `JwksResolver` keeps a fetch failure's `HttpClientError` cause without the request's credentials. `peerDependencies` is `effect` alone.

The package never touches `crypto.subtle`. Signing and verifying run on core's `Signature` service, which every signing or verifying operation (`Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate`, `TestIssuer`) requires in `R` per [require services in `R`](../conventions/require-in-r-default.md); the application provides `Signature.layerWebCrypto` over `SecureRandom.layerWebCrypto` once at its edge. Key import (`JwtKey.fromPkcs8Pem`, `JwtKey.fromJwk`, and the resolver's imports) needs no service, because core imports on its `WebCrypto` reference. There is no `unsupportedRuntime` reason: the package no longer acquires WebCrypto itself, so a runtime without it fails inside core's layer or import instead.

## Core-owned list

Nothing here is re-derived from core. Compact parsing and encoding, canonical base64url, the algorithm allowlist, the signature, PEM/DER and PKCS#1-to-PKCS#8 conversion, key-strength checks, key selection from a set, and the registered-claim checks are all core `effect/jose` / `effect/crypto`. `SigningKey` and `VerificationKey` are core's `Jwk.PrivateKey` and `Jwk.PublicKey` themselves, and `JoseHeader` is core's `Jws.ProtectedHeader`, so a key from `JwtKey` works with core `Jws` and `Jwt` directly. HTTP is `effect/http` and time is `Clock`, never `Date.now()`. `src/internal/jose.ts` is the one seam: it maps core's `JoseError` onto `JwtError` and lets a key, or a function from the header to one, stand in for core's `Jwks` service so core's `verifyWithKeySet` does the work.

## Kit-only residue

What this package still owns, because core does not provide it:

- **`JwksResolver` and `JwksStore`.** Core's `Jwks.makeRemote` fetches one configured HTTPS URL into an in-memory cache. The resolver adds OIDC discovery per issuer (the discovery document's `issuer` must match exactly), many issuers behind one service, a `JwksStore` seam that a Cloudflare Worker backs with KV so isolates share a fetched set, a store-versus-own-copy freshness rule, and `http://localhost` issuers for tests. Selection and import within a fetched set are core's (`Jwks.makeLocal`, one per set, so a key is imported once per set).
- **PEM convenience.** Core's `Jwk.importPkcs8` takes PKCS#8 only and real newlines only. `JwtKey.fromPkcs8Pem` also takes PKCS#1 (GitHub App keys) through core's `KeyFormat.pkcs1`, and unescapes the one-line `\n` form an environment variable carries.
- **Verification defaults.** A 60 second clock tolerance (core's is zero), `exp` required unless `requireExpiry: false` (core makes it optional), a future `iat` always refused (core checks `iat` only under `maxTokenAge`), and a key-resolver function in place of a `Jwks` service.
- **`JwtError`.** One flat `reason` string to route on, where core nests a reason class; and a sync `Result` form of `Jws.decodeUnverified`.
- **`TestIssuer`.** Core has no test issuer.

Everything else would map one-to-one onto core, so dropping the package means a consumer re-creates the resolver, the PKCS#1 path, the defaults and the test issuer, or adopts core's narrower `Jwks.makeRemote`.

## Modules

| File | Responsibility |
| --- | --- |
| `src/JwtError.ts` | the one tagged error, with its `reason` union |
| `src/internal/jose.ts` | the core seam: `JoseError` to `JwtError`, the key-to-`Jwks` shim, the asymmetric allowlist |
| `src/Jwk.ts` | `Jwk` and `Jwks` schemas (looser than core's `PublicJwk`: a set keeps a key core cannot use instead of failing whole) |
| `src/JwtKey.ts` | `SigningKey` and `VerificationKey` (core's key types) and the importers (`fromPkcs8Pem`, `fromJwk`, `generate`) |
| `src/Jws.ts` | `Jws.sign`, `Jws.verify` and `Jws.decodeUnverified` over core `Jws` |
| `src/Jwt.ts` | `RegisteredClaims`, `Jwt.sign` and `Jwt.verify` over core `Jwt.verifyWithKeySet`, with this package's defaults |
| `src/JwksStore.ts` | the cache seam with its memory layer |
| `src/JwksResolver.ts` | discovery, then JWKS, then a key through core `Jwks.makeLocal`, with a rate-limited refetch |
| `src/index.ts` | root entrypoint |
| `src/testing.ts` | `TestIssuer`, the `./testing` entrypoint |

The package follows the [module-per-concept layout](../conventions/module-per-concept-layout.md): one `src/<Concept>.ts` per exported concept and only the entrypoints re-export. `Jws`, `Jwt`, `JwtKey` and `TestIssuer` are grouped-statics containers in the house class form (a private constructor and `static readonly` members), as [no barrel re-exports](../conventions/no-barrel-re-exports.md) requires and as `@effected/oidc`, `crypto` and `webhooks` do. None of the four shares its name with a type, so none is a name-collision holdout.

## Behaviour

- Algorithms are every asymmetric one core implements: `RS256`-`RS512`, `PS256`-`PS512`, `ES256`-`ES512` and `EdDSA` (Ed25519). HMAC is refused as `unsupportedAlgorithm` before any key is resolved, because a published key must never select a shared secret. `alg: "none"`, and any algorithm core does not know, fail to parse and are `malformed`. The algorithm comes from the key, never the token header; a header `alg` that differs from the key's fails as `algorithmMismatch` and no other algorithm is attempted.
- `JwtError.reason` is exactly `malformed`, `unsupportedAlgorithm`, `algorithmMismatch`, `badSignature`, `unknownKid`, `expired`, `notYetValid`, `wrongIssuer`, `wrongAudience`, `claims`, `key` or `jwksFetch`; the core `JoseError` rides on `cause`. Consumers route on `reason`, never on `message` or `detail`, whose prose is core's where core produced the failure.
- Private key material is always `Redacted` on the way in, and `Redacted.value` is read only at the import call. Core holds an imported key as bytes behind a `Signature.PrivateKey` that prints only its algorithm; it is not a non-extractable `CryptoKey`.
- A PKCS#1 (`BEGIN RSA PRIVATE KEY`) key, which is what github.com hands out for an App, is read by core's `KeyFormat.pkcs1`, re-encoded as PKCS#8 and imported for the requested RSA algorithm, so it works on workerd too. An App JWT signed this way is byte-for-byte the token the earlier WebCrypto engine produced (RS256 is deterministic).
- `Jwt.verify` checks claims in core's order: payload a JSON object (`claims`), registered-claim types (`claims`), `exp` present unless `requireExpiry: false` (`claims`), `iss` (`wrongIssuer`), `aud` (`wrongAudience`; an `aud` array containing the expected audience among others passes), `exp` (`expired`), `nbf` (`notYetValid`), the caller's schema (`claims`), then a future `iat` (`notYetValid`). Time is `Clock`'s, in whole seconds, so `TestClock` drives it; the tolerance is 60 seconds by default.
- A JWKS rotation (a `kid` absent from the cached set) triggers one refetch and then success. A second unknown `kid` within the refetch interval is `unknownKid` with no further fetch. A key whose `use` is not `sig`, whose `key_ops` lacks `verify` or whose `alg` differs never matches; a header without `kid` matches when exactly one key fits the algorithm; a `kid` matching several keys is `unknownKid`.

## The testing entrypoint

`./testing` exports `TestIssuer`: a generated key pair with a signer, and an in-memory `HttpClient` serving the issuer's discovery document and JWKS, so a consumer test verifies through the real `JwksResolver` with no network. `TestIssuer.rotate` adds a key under a new `kid`, served alongside the earlier ones; the resolver's refetch interval still applies, so a test under `TestClock` advances it before verifying with the new key. The issuer must be `https:` or a localhost `http:` URL, because the resolver refuses any other.

`src/TestIssuer.ts` names root types through a type-only `import type * as Root from "@effected/jwt"` self-reference and imports runtime values relatively, the [`@effected/images`](images.md) pattern, with `dtsExternals` set. The build emits one module per source file, so `TestIssuer` uses the root's own classes rather than copies. The bundler's second API Extractor pass maps the self-reference to the root's built declarations rather than into `src`, so it neither crashes nor reports `ae-wrong-input-file-type` (the failure [the self-reference gotcha](../gotchas/self-reference-api-extractor-pass-looks-clean-when-it-crashes.md) describes). The prod build settles with zero warnings, and the pass is proven to run: emptying the second pattern below brings back all seventeen `ae-forgotten-export` warnings for `testing.d.ts`.[^build]

The suppression list in `savvy.build.ts` is exactly two entries, both `ae-forgotten-export`:

- the house `_base` pattern, for the heritage types Effect's class factories synthesize;
- the self-reference names, matched only for `testing.d.ts`: `Root` itself and the sixteen root symbols `TestIssuer`'s signatures reach transitively (`CachedJwks`, `DecodedJws`, `JoseHeader`, `Jwk`, `Jwks`, `JwksResolver`, `JwksResolverOptions`, `JwksResolverShape`, `JwksStore`, `JwksStoreShape`, `JwtAlgorithm`, `JwtError`, `JwtErrorReason`, `SigningKey`, `VerificationKey`, `VerifyOptions`), every one exported by the root entry point.

`issues.json` lists only `Root` in its suppressed bucket: the sixteen root symbols, which arrive with no file or line, are suppressed without being recorded there, so read the suppression's reach from the control above, not from that count. Dropping any name from the second pattern brings its warning back, so a genuinely forgotten export from either entry point still fails the build. Whether a second entrypoint is warranted follows [the measured-cost rule](../decisions/second-published-entrypoint.md).

## Consumers

[`@effected/github`](github.md) takes a regular dependency on this package for GitHub App authentication and Actions OIDC verification. The first external consumer is savvy-web/silk-app. The issues driving the work are 768 (the two JWT halves), 970 (the installation token store), 975 (additive `Installation` fields) and 827 (`GitHubError.fromResponse`).

[^build]: `packages/jwt/savvy.build.ts`, whose comments state the suppression's scope; the gate's result is `packages/jwt/dist/prod/issues.json` after a build (zero warnings, four suppressed: three `_base` entries and `Root`).
