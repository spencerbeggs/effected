# CLAUDE.md — @effected/jwt

JWS, JWT, JWK and JWKS sign and verify over WebCrypto, safe for Cloudflare Workers.

**Design doc:** `@./okf/modules/jwt.md` — load before changing behavior; it is the contract this package implements.

## Tier: boundary

`effect` is the only peer. **No runtime dependencies and no `node:` import anywhere under `src/`.** `subtle` is read from `globalThis.crypto`; when absent the package fails with `JwtError` and `reason: "unsupportedRuntime"`. Base64url is core `effect/encoding/Base64Url`; never hand-roll it. Tests may use `node:crypto`; `src/` may not.

## Rules

- RS256 and ES256 only. `alg: "none"` is never accepted. The algorithm comes from the key, never the token header.
- Private key material is `Redacted`; read it only at the import call.
- Time is read from `Clock`, never `Date.now()`.
- Module-per-concept: one exported concept per `src/<Concept>.ts`, engines in `src/internal/`, only `index.ts` and `testing.ts` re-export.

```bash
pnpm vitest run packages/jwt        # from the repo root
pnpm build --filter @effected/jwt   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
