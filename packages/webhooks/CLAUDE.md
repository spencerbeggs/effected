# CLAUDE.md — @effected/webhooks

Inbound webhook signature verification as pure functions over a header lookup, the raw body and the receive time.

**Design doc:** `@../../okf/modules/webhooks.md` — load before changing behavior; it is the contract this package implements.

## Tier: boundary

`effect` is the only peer; `@effected/crypto` is the only runtime dependency. **No `node:` import anywhere under `src/`.** Every preset's HMAC and secret comparison runs on core's `Mac.Mac` (`effect/crypto`) through `@effected/crypto`, so every `verify` requires `Mac.Mac` in `R`; a `CryptoError` is a defect (`orDie`), and `E` stays `WebhookVerificationError` alone. Tests provide `MacLive` from `__test__/helpers.ts` (`Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto`). No HTTP framework: input is plain data. Tests may use `node:crypto`, `svix` and `stripe`; `src/` may not.

## Rules

- The signature is checked before the timestamp, in every preset.
- Staleness is judged against the caller's receive time, never the wall clock.
- Secret handling follows the vendor exactly (Standard Webhooks decodes `whsec_`; Stripe does not). A malformed secret is a defect, not a typed failure.
- Never annotate a secret, signature or body on a span.
- Delivery identity, vendor naming and payload decoding are the caller's, not this package's.

```bash
pnpm vitest run packages/webhooks        # from the repo root
pnpm build --filter @effected/webhooks   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`).
