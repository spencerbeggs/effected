---
"@effected/jwt": minor
---

## Bug Fixes

### Security

* The `JwtError` `jwksFetch` cause keeps a redacted copy of the request, so no credential is readable from a failed JWKS fetch. `@effected/jwt` now depends on `@effected/crypto`.
