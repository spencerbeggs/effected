---
id: "0033"
title: JWT and OIDC verification report different reasons
kind: behaviour
shows: behavioural
applies:
  "@effected/jwt": ">=0.8.0"
  "@effected/oidc": ">=0.3.0"
  "@effected/github": ">=0.27.0"
detect: ["unsupportedAlgorithm", "unknownKid", "wrongIssuer", "wrongAudience", "\"expired\"", "JwtError"]
---

Verification now routes some failures to different `JwtError` reasons. `@effected/oidc` and `@effected/github`'s `ActionsOidc` follow `jwt`:

- `alg: "none"` and any unknown algorithm are `malformed` (were `unsupportedAlgorithm`). HMAC is still `unsupportedAlgorithm`.
- A JWKS key whose `use` is not `sig` is `unknownKid` (was `key`).
- `Jwt.verify` checks `iss` and `aud` before `exp` and `nbf`, so a token that fails both reports `wrongIssuer` or `wrongAudience` where it reported `expired`.
- `JwtError.detail` text changes.

What to change: review every branch on `reason` and every assertion on it or on `detail`. Logic that treated `unsupportedAlgorithm` as "reject `alg: none`" must handle `malformed`.

How it shows itself: the reason names still compile, so only tests find it.
