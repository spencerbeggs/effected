---
type: Decision
title: The JWT algorithm comes from the key, never the token header
description: A key carries its algorithm, the token header alg is only checked against it, and alg none is unrepresentable, which closes key-confusion attacks.
status: draft
tags:
  - security
  - architecture
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-09T00:00:00Z
  - id: rfc8725
    resource: https://www.rfc-editor.org/rfc/rfc8725
    title: "RFC 8725, JSON Web Token Best Current Practices: perform algorithm verification, use a key with exactly one algorithm, never accept none"
  - id: rfc7515
    resource: https://www.rfc-editor.org/rfc/rfc7515
    title: "RFC 7515, JSON Web Signature: the protected header's alg and the compact serialization"
  - id: rfc7518
    resource: https://www.rfc-editor.org/rfc/rfc7518
    title: "RFC 7518, JSON Web Algorithms: RS256, ES256 and the unsecured none algorithm"
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T22:29:55Z
  body_sha256: 56d709858af72b69b75d2530d5fced176e7e53e388ea4648ae46d6f14246ae03
---

# The JWT algorithm comes from the key, never the token header

## Context

A compact JWS header names the algorithm that signed it, and that header is attacker-controlled. A verifier that dispatches on it can be steered into verifying an `HS256` token with an RSA public key used as an HMAC secret, or into accepting `alg: "none"`. The [`@effected/jwt` module](../modules/jwt.md) verifies tokens for GitHub Actions OIDC and GitHub App flows, where the issuer's key is known in advance.

## Decision

Keys carry their algorithm: a signing or verification key is imported as `RS256` or `ES256` (P-256) and remembers which. Verification reads the algorithm from the key and checks the header's `alg` against it; a mismatch fails as `algorithmMismatch` and no other algorithm is attempted. `none` is unrepresentable, so there is no code path that accepts an unsigned token. A header naming an algorithm outside the supported two is `unsupportedAlgorithm`.

## Alternatives rejected

- **Header-driven dispatch.** Choosing the verification algorithm from the header is the key-confusion vulnerability: the token's author decides how the token is checked.

## Consequences

A key must be imported with its algorithm known, which JWK `alg` and `kty`/`crv` and the key type provide. Callers cannot verify a token with an algorithm they did not import a key for, and the failure is a typed `reason` they route on.
