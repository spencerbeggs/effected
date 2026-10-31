# CLAUDE.md — @effected/jwt

JWS, JWT, JWK and JWKS sign and verify, safe for Cloudflare Workers: a thin layer over core `effect/jose`, which owns every signature, key import, segment codec and claim check.

**Design doc:** `@./okf/modules/jwt.md` — load before changing behavior; it is the contract this package implements.

## Tier: boundary

`effect` is the only peer. **The one runtime dependency is `@effected/crypto`** (WebCrypto-only, no `node:` import, workerd-safe; for `HttpRedaction`, which scrubs a kept fetch cause), **and there is no `node:` import anywhere under `src/`.** Add no other dependency. **No crypto engine lives here**: never call `crypto.subtle`, build DER, keep an algorithm table or encode segments — delegate to core `effect/jose` / `effect/crypto`, and translate its `JoseError` in `src/internal/jose.ts`. Signing and verifying require core's `Signature` service in `R`; tests provide it from `__test__/crypto.ts` with `layer(CryptoLive, { buildPerTest: true })` (per-test, so each test keeps its own `TestClock`). Tests may use `node:crypto`; `src/` may not.

## Rules

- Every asymmetric algorithm core implements (RS/PS/ES 256-512, EdDSA); never HMAC, which a published key must not select. `alg: "none"` is never accepted. The algorithm comes from the key, never the token header.
- Keep only what core does not do: discovery-backed `JwksResolver` / `JwksStore`, PKCS#1 and escaped-newline PEM, the verification defaults, `JwtError` routing, `TestIssuer`. When core gains one of these, delete the kit's copy.
- Private key material is `Redacted`; read it only at the import call.
- Time is read from `Clock`, never `Date.now()`.
- Module-per-concept: one exported concept per `src/<Concept>.ts`, engines in `src/internal/`, only `index.ts` and `testing.ts` re-export.

```bash
pnpm vitest run packages/jwt        # from the repo root
pnpm build --filter @effected/jwt   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
