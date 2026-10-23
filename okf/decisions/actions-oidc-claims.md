---
type: Decision
title: One GitHub Actions OIDC claims class, ActionsOidcClaims in @effected/github
description: "github-actions' wire-shaped OidcClaims is removed; the runner token issuer and the provenance builder read github's ActionsOidcClaims, the same class the verifier returns."
status: stable
tags:
  - architecture
  - github
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: oidc-claims
    resource: ../../packages/github-actions/src/OidcTokenIssuer.ts
    title: "OidcClaims: snake_case wire names, ids as strings, no sub or aud"
  - id: actions-oidc-claims
    resource: ../../packages/github/src/ActionsOidc.ts
    title: "ActionsOidcClaims: camelCase, integer ids, actor required, encodeKeys to the wire"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-22T23:55:11Z
integrity:
  generated:
    body: 25f3db58bcb64167
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: cb791ffe70a63256
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# One GitHub Actions OIDC claims class, ActionsOidcClaims in @effected/github

## Context

Two classes described the same GitHub Actions ID token. [`github-actions`](../modules/github-actions.md)' `OidcClaims` kept the wire's snake_case names and its string ids, omitted `sub` and `aud`, and fed the SLSA provenance builder.[^oidc-claims] [`github`](../modules/github.md)' `ActionsOidcClaims` is camelCase with integer ids, requires `actor`, `sub` and `aud`, and maps back to the wire through `Schema.encodeKeys`.[^actions-oidc-claims] A consumer that both minted and verified a token held two types for one fact.

## Decision

`OidcClaims` is removed. `OidcTokenIssuer.claims` decodes through `ActionsOidcClaims`' wire codec and returns it, and `ActionsProvenance` reads its camelCase fields, rendering the integer ids back to strings where the provenance statement wants them. `github-actions` already depends on `github`, so no edge is added.[^owner]

## Alternatives rejected

- **Keep both.** No cost today, but every new claim lands twice and the two drift.
- **Move the class into `@effected/oidc`.** It is GitHub's vocabulary, not OIDC's; the [oidc package](oidc-package-scope.md) stays provider-free.
- **Keep `OidcClaims` as the survivor.** Its string ids and missing `sub`/`aud` are the weaker type, and it is the class with fewer readers.

## Consequences

Breaking for `github-actions`: `OidcClaims` leaves the public API, and `OidcTokenIssuer.layerFor` and `unsignedTokenFor` take `ActionsOidcClaims`, so a test double must now supply `actor`, `sub` and `aud`. The provenance output must stay byte-identical, which its existing test pins.

[^owner]: conversation with the repository owner
[^oidc-claims]: `../../packages/github-actions/src/OidcTokenIssuer.ts`
[^actions-oidc-claims]: `../../packages/github/src/ActionsOidc.ts`
