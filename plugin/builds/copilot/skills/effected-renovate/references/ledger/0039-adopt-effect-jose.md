---
id: "0039"
title: Adopt effect/jose for JWS, JWE, JWT and JWK handling
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["from \"jose\"", "\"jose\": *\"", "jsonwebtoken"]
---

Core `effect/jose` ships `Jws`, `Jwe`, `Jwt`, `Jwk` and `Jwks`, with a typed `JoseError`, on top of `effect/crypto`'s `Signature` service. `@effected/jwt` now runs on it, so its keys are core's and work with core `Jws` and `Jwt` directly.

Where to look: a `jose` or `jsonwebtoken` dependency, and hand-written JWT verification. Replace only where the semantics match, and check the installed `effect/dist/jose/` before adopting; several modules are `@stability unstable`. Entry 0047 covers moving off `@effected/jwt` itself.
