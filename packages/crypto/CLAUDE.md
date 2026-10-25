# CLAUDE.md — @effected/crypto

HMAC, constant-time comparison and AWS SigV4 request signing over WebCrypto, safe for Cloudflare Workers, plus `Fingerprint`: stable SHA-256 fingerprints of JSON-shaped values and the three-way `DriftDecision`. Its canonicaliser (`src/internal/canonical.ts`) is deliberately not `@effected/jsonc`'s RFC 8785 one: drift detection drops `undefined` members where RFC 8785 refuses them.

**Design doc:** `@../../okf/modules/crypto.md` — load before changing behavior; it is the contract this package implements. Backends: `okf/decisions/crypto-backends.md`. Known edge: `okf/limitations/constant-time-compare.md`.

## Tier: boundary

`effect` is the only peer. **No runtime dependencies and no `node:` import anywhere under `src/`.** HMAC reads `globalThis.crypto.subtle`; when absent it fails with `CryptoError` and `reason: "unsupportedRuntime"`. Every digest of a payload goes through core `Crypto.digest`, required in `R` — never `subtle.digest`. A keyed operation is WebCrypto: `ConstantTime.secretsEqual` blinds with HMAC under a fresh `subtle.generateKey` key, so it needs nothing in `R`. WebCrypto calls are truly asynchronous; say so in the `@remarks` of anything that awaits one. Hex and base64 are core `effect/encoding`; never hand-roll them. Tests may use `node:crypto`; `src/` may not.

## Rules

- Key material is `Redacted` or raw bytes; read a `Redacted` only at the import call. Never annotate a key, secret or signature on a span.
- Time is caller-supplied, never `Date.now()`.
- Module-per-concept: one exported concept per `src/<Concept>.ts`, engines in `src/internal/`, only `index.ts` re-exports. Grouped statics are classes, never `as const` objects.

```bash
pnpm vitest run packages/crypto        # from the repo root
pnpm build --filter @effected/crypto   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
