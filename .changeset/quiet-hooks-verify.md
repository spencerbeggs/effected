---
"@effected/webhooks": minor
---

## Features

### New package: `@effected/webhooks`

Inbound webhook signature verification as presets over `@effected/crypto`. Ships verifiers for GitHub, Stripe, Standard Webhooks (Svix), Sanity, a generic HMAC-header scheme (`HmacHeader`) and a shared-secret scheme (`SharedSecret`), each cross-checked against the `svix` and `stripe` libraries' own signing. The signature is always checked before the timestamp, and staleness is judged against the caller's receive time. A request is described once as a `WebhookRequest` and a rejected one fails with a typed `WebhookVerificationError`, so a handler never has to inspect headers or compare signatures itself.
