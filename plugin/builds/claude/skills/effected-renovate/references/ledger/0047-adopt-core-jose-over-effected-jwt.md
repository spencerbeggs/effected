---
id: "0047"
title: Consider core effect/jose in place of @effected/jwt
kind: adopt
shows: none
applies:
  "@effected/jwt": ">=0.8.0"
detect: ["from \"@effected/jwt\""]
---

`@effected/jwt` now runs on core `effect/jose`. A consumer that verifies against a key it already holds, or one fixed HTTPS JWKS URL, and signs with PKCS#8 keys can use core directly (`Jwt.verify`, `Jwks.layerRemote`, `Jwk.importPkcs8`).

Keep `@effected/jwt` for OIDC discovery across issuers, a KV-backed `JwksStore` on Workers, PKCS#1 GitHub App keys, its 60 s and required-`exp` defaults, or `TestIssuer`. The kit may drop the package later, so prefer core for new code that fits. Check the installed `effect/dist/jose/` before switching.
