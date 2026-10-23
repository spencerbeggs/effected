---
type: Decision
title: "@effected/oidc is a thin package that owns the IdentityToken contract"
description: "OIDC gets its own package over @effected/jwt holding the issuer contract, standard ID-token claims, an unverified decode and a guarded verify — not a fuller OIDC client, and not left scattered across sbom, github and github-actions."
status: stable
tags:
  - architecture
  - bundle
  - security
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: jwt-resolver
    resource: ../../packages/jwt/src/JwksResolver.ts
    title: "Issuer discovery and JWKS resolution already in jwt"
  - id: release-action
    resource: conversation with the silk-release-action session, 2026-10-22
    title: "Its pnpr workload credential needs only OidcTokenIssuer.token(audience)"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-22T23:55:11Z
integrity:
  generated:
    body: def314a0c49a8b4b
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 2eefabbc33f47f29
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# @effected/oidc is a thin package that owns the IdentityToken contract

## Context

OIDC knowledge was spread over three packages: the issuer contract `IdentityToken` in [`sbom`](../modules/sbom.md), the runner token mint and a private JWT segment codec in [`github-actions`](../modules/github-actions.md), and the Actions token verifier in [`github`](../modules/github.md). A proposal from the systems session put a full `@effected/oidc` package beneath them. On inspection, [`jwt`](../modules/jwt.md) already performs issuer discovery, JWKS resolution and claim validation,[^jwt-resolver] and the one downstream consumer named, silk-release-action, needs nothing beyond `OidcTokenIssuer.token(audience)`.[^release-action]

## Decision

Keep the package, and keep it thin: the `IdentityToken` contract (moved from `sbom`), `IdTokenClaims`, `Oidc.decodeUnverified` and `Oidc.verify` with the empty-audience guard. It holds no provider-specific claims; GitHub's stay in `github` (see [one Actions OIDC claims class](actions-oidc-claims.md)).[^owner]

## Alternatives rejected

- **No package.** The cheapest cut, since `jwt` does the work. Rejected because the issuer contract then stays in `sbom`, an SBOM package, where a non-SBOM consumer of an ID token has no reason to look, and the private codec in `github-actions` keeps duplicating `Jws.decodeUnverified`.
- **A full OIDC client** (authorization-code flow, token exchange, userinfo). No consumer needs one; it would be scope without a caller.
- **Put the contract in `jwt`.** `jwt` is token mechanics with no notion of an identity provider; an issuer service there would blur that boundary.

## Consequences

`IdentityToken` and `IdentityTokenError` are imported from `@effected/oidc`, a breaking change for anyone importing them from `@effected/sbom`; the kit is `0.x`, so it is a minor bump. `IdentityToken.ts` must import nothing but `effect`, so `sbom` still links no JWT code, and a reachability test holds that. `ActionsOidc` keeps its public API, re-expressed on `Oidc.verify`.

[^owner]: conversation with the repository owner
[^jwt-resolver]: `../../packages/jwt/src/JwksResolver.ts`
[^release-action]: conversation with the silk-release-action session, 2026-10-22
