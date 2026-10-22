# CLAUDE.md — @effected/oidc

The kit's OpenID Connect vocabulary over `@effected/jwt`: the `IdentityToken` issuer contract, ID-token claims, an unverified decode and a guarded verify.

**Design doc:** `@../../okf/modules/oidc.md` — load before changing behavior. Scope: `okf/decisions/oidc-package-scope.md`.

## Tier: boundary

`effect` is the only peer; `@effected/jwt` is the only runtime dependency. No `node:` import.

## Rules

- `src/IdentityToken.ts` imports nothing but `effect` — `sbom` depends on that so it links no JWT code. `__test__/reachability.test.ts` pins it; do not weaken it.
- No provider-specific claims here. GitHub's live in `@effected/github`.
- `Oidc.verify` refuses an empty audience before any network call, and looks keys up for the configured issuer, never the token's own `iss`.
- Module-per-concept; only `index.ts` re-exports.

```bash
pnpm vitest run packages/oidc        # from the repo root
pnpm build --filter @effected/oidc   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
