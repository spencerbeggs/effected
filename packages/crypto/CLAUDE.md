# CLAUDE.md — @effected/crypto

HMAC, constant-time comparison and AWS SigV4 request signing over core `effect/crypto` services, safe for Cloudflare Workers, plus `HttpRedaction` (credential-free copies of core `HttpClientError`, request and response values: the one scrub every HTTP-speaking kit package calls where it keeps a cause; pure, no `Effect`, and it must stay dependency-free so `npm`, `runtimes`, `jwt` and `github-actions` can all depend on it) and `Fingerprint`: stable SHA-256 fingerprints of JSON-shaped values and the three-way `DriftDecision`. Its canonicaliser (`src/internal/canonical.ts`) is deliberately not `@effected/jsonc`'s RFC 8785 one: drift detection drops `undefined` members where RFC 8785 refuses them.

**Design doc:** `@../../okf/modules/crypto.md` — load before changing behavior; it is the contract this package implements. Backends: `okf/decisions/crypto-backends.md`. Known edge: `okf/limitations/constant-time-compare.md`.

## Tier: boundary

`effect` is the only peer. **No runtime dependencies and no `node:` import anywhere under `src/`.** Every HMAC goes through core `Mac.Mac` (`effect/crypto`), required in `R` — `Hmac`, `ConstantTime.secretsEqual` (blinds with `Mac.generateKey(Mac.hmacSha256)` + `sign`, checks with `Mac.verify`) and SigV4's key derivation; never `crypto.subtle` directly. Every digest of a payload goes through core `Digest.Digest`, required in `R` — never `subtle.digest`. Byte comparison is core `Mac.timingSafeEqual` or `Mac.verify`; never hand-roll the loop. The error channel is core's `CryptoError` (`effect/crypto`); this package defines no crypto error of its own, and does not re-export core's. On the WebCrypto layers a runtime with no `crypto.subtle` **dies** rather than failing. WebCrypto calls are truly asynchronous; say so in the `@remarks` of anything that awaits one on `Mac.layerWebCrypto`. Hex and base64 are core `effect/encoding`; never hand-roll them. Tests provide `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (and may cross-check on `NodeCrypto.layerMac`); tests may use `node:crypto`, `src/` may not.

## Rules

- Key material is `Redacted` or raw bytes; read a `Redacted` only where its bytes are handed to `Mac`. Never annotate a key, secret or signature on a span.
- Time is caller-supplied, never `Date.now()`.
- Module-per-concept: one exported concept per `src/<Concept>.ts`, engines in `src/internal/`, only `index.ts` re-exports. Grouped statics are classes, never `as const` objects.

```bash
pnpm vitest run packages/crypto        # from the repo root
pnpm build --filter @effected/crypto   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
