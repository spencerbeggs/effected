---
"@effected/jwt": minor
---

## Breaking Changes

### Class form

`Jws`, `Jwt`, `JwtKey` and `TestIssuer` (from `@effected/jwt/testing`) are now classes with a private constructor and static members instead of typed const objects. Call shapes and `Object.keys` are unchanged. What a caller can observe:

- `typeof` is `"function"` instead of `"object"`, and `JSON.stringify` returns `undefined` instead of `"{}"`.
- `typeof Jws` and the others are class-constructor types, so a hand-built object double typed as one no longer type-checks.

## Bug Fixes

- `JwksResolver` maps a non-UTF-8 JWKS body and a discovered `jwks_uri` that is not a URL through `Effect.try`, with the same `reason`, `detail` and `cause` as before.
