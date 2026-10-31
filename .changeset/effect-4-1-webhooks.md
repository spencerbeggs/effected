---
"@effected/webhooks": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Every preset requires core Mac

`@effected/crypto` now takes its HMAC from core's `Mac.Mac` (from `effect/crypto`), so `GitHub.verify`, `Stripe.verify`, `StandardWebhooks.verify`, `Sanity.verify`, `HmacHeader.verify` and `SharedSecret.verify` require `Mac.Mac` in `R`. Provide `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (any WebCrypto runtime, Workers included) or `NodeCrypto.layerMac` from `@effect/platform-node`. The error channel is unchanged: every preset fails only with `WebhookVerificationError`, and a crypto failure stays a defect. `Webhooks.checkFreshness` needs nothing.
