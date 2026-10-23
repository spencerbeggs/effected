---
type: Module
title: "@effected/oidc"
description: The kit's OpenID Connect vocabulary over @effected/jwt — the IdentityToken issuer contract, standard ID-token claims, an unverified decode and a discovery-backed verify.
status: draft
kind: package
resource: ../../packages/oidc
layer: L2
tags:
  - architecture
  - security
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: identity-token
    resource: ../../packages/oidc/src/IdentityToken.ts
    title: "The inverted issuer contract, moved here from sbom"
  - id: actions-oidc
    resource: ../../packages/github/src/ActionsOidc.ts
    title: "The GitHub Actions verifier, with its empty-audience guard"
  - id: jwt-resolver
    resource: ../../packages/jwt/src/JwksResolver.ts
    title: "jwt already performs issuer discovery and JWKS resolution"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-23T00:20:13Z
integrity:
  generated:
    body: 5254f4564f885b06
---

# `@effected/oidc`

`@effected/oidc` is the kit's OpenID Connect vocabulary: the contract for obtaining an ID token, the standard ID-token claims, and the two ways to read one. It is deliberately thin. [`jwt`](jwt.md) already does the hard work (JWS verification, issuer discovery, JWKS resolution with rotation), so this package names the OIDC concepts on top of it and gives them one home. Why it exists at all, and why it hosts the issuer contract, is [its own decision](../decisions/oidc-package-scope.md).[^owner][^jwt-resolver]

## Tier and dependencies

Boundary tier. A regular dependency on [`jwt`](jwt.md); `peerDependencies` is `effect`. No `node:` import. Its consumers are [`sbom`](sbom.md), [`github`](github.md) and [`github-actions`](github-actions.md).

## Modules

| File | Responsibility | Reaches |
| --- | --- | --- |
| `src/IdentityToken.ts` | `IdentityToken`, `IdentityTokenError`, `layerStatic`, `makeTest`, `layerTest` | `effect` only |
| `src/IdTokenClaims.ts` | `IdTokenClaims` | `effect`, `@effected/jwt` |
| `src/Oidc.ts` | `Oidc.decodeUnverified`, `Oidc.verify` | `effect`, `@effected/jwt` |
| `src/index.ts` | root entrypoint, re-exporting by name only | |

The `Reaches` column is an invariant with a test: `IdentityToken.ts` imports nothing but `effect`, so [`sbom`](sbom.md), which needs only the contract, links no JWT code. A reachability suite pins it per [the bundle reachability suite convention](../conventions/bundle-reachability-suite.md).

## Surfaces

- **`IdentityToken`** is the inverted issuer contract: `token(audience) => Effect<Redacted<string>, IdentityTokenError>`. The package declares it and implementers ship layers: [`github-actions`](github-actions.md)' `ActionsIdentityToken` over the runner's token service, and `layerStatic` for a caller already holding a token. It moved here unchanged from `sbom`.[^identity-token]
- **`IdTokenClaims`** is `jwt`'s `RegisteredClaims` plus the OIDC Core ID-token claims (`azp`, `nonce`, `auth_time`, `acr`, `amr`). A provider's own claims extend it through a caller-supplied Schema rather than through a subclass here.
- **`Oidc.decodeUnverified(token, claims)`** is `Jws.decodeUnverified` plus a decode of the payload against `claims`. It checks no signature, and it says so in its name. It is for reading a token this process was handed by a trusted runtime, never for authorizing anything.
- **`Oidc.verify(token, { issuer, audience, claims, clockTolerance? })`** is `Jwt.verify` keyed through `JwksResolver.forIssuer(issuer)`. The key is always looked up for the configured issuer, never the token's own `iss`. An empty audience fails as `JwtError` `wrongAudience` before any network call, because an OIDC token verified without an audience is a token minted for anyone. That guard moved here from `ActionsOidc`.[^actions-oidc]

## Errors

`IdentityTokenError` (audience plus cause) is the issuer contract's failure; its audience is calling code. `Oidc.verify` and `Oidc.decodeUnverified` fail with `jwt`'s `JwtError` and add no type of their own, since its `reason` union already names every way a token is rejected.

## Observability

Named `Effect.fn` spans on `Oidc.verify` and `Oidc.decodeUnverified`, annotated with the issuer and audience; never the token.

## Testing

`Oidc.verify` is tested through `jwt`'s `TestIssuer`, so discovery and JWKS resolution run for real with no network. `IdentityToken` keeps its test layers.

[^owner]: conversation with the repository owner
[^identity-token]: `../../packages/oidc/src/IdentityToken.ts`
[^actions-oidc]: `../../packages/github/src/ActionsOidc.ts`
[^jwt-resolver]: `../../packages/jwt/src/JwksResolver.ts`
