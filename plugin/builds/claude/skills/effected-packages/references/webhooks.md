# @effected/webhooks

Inbound webhook signature verification over WebCrypto, safe for Cloudflare Workers: pure verifiers over a header lookup, the raw body, the receive time and the secret. Boundary tier. It has one regular dependency, `@effected/crypto` (HMAC and constant-time compare), and `effect` is the only peer; no `node:` import and no framework adapter.

## Import

```ts
import { GitHub, HmacHeader, Sanity, SharedSecret, StandardWebhooks, Stripe, Webhooks, WebhookVerificationError } from "@effected/webhooks";
import type { FreshnessOptions, WebhookRequest } from "@effected/webhooks";
```

**Platform**: nothing. Every preset, `SharedSecret` included, needs nothing in `R` and fails only with `WebhookVerificationError`; a WebCrypto failure is a defect.

**Async**: every `verify` runs on WebCrypto, which is truly asynchronous. A test that forks a verify and then adjusts `TestClock` can race or hang; await it, or gate the clock on a latch.

## Core API

Every preset is a class with one static `verify(request, options?)` → `Effect<…, WebhookVerificationError>`.

- **`WebhookRequest`** — plain data, so it adapts from core `effect/http`, a Workers `Request` or a test: `header(name)` → `Option<string>` (called with lower-case names; return the value as received: the presets guarantee that an empty value counts as absent, and the signature presets trim and treat whitespace-only as absent, so the adapter does neither), `body: Uint8Array` (**the exact bytes received, never a re-serialized parse**), `receivedAt: DateTime.Utc` (staleness is judged against this, never the wall clock) and `secret: Redacted<string>` (in the form the vendor shows it).
- **`GitHub.verify(request)`** — `x-hub-signature-256`: `sha256=` plus the hex HMAC-SHA256 of the body. The legacy SHA-1 header is ignored. GitHub signs no timestamp, so deduplicate on `x-github-delivery`. Succeeds with `void`.
- **`Stripe.verify(request, { tolerance? })`** — `stripe-signature`: the last valid `t` (Unix seconds) wins, any `v1` may match (a secret roll signs with both), `v0` is ignored. The `whsec_` secret is the key verbatim, never decoded. Succeeds with `StripeVerified { timestamp }`.
- **`StandardWebhooks.verify(request, { tolerance? })`** — the Svix scheme (Clerk and Resend send through Svix). Reads `svix-id`/`svix-timestamp`/`svix-signature`, each falling back to its `webhook-` name; the signature header is a space-separated list of `v1,<base64>`, any of which may match. The secret is `whsec_` plus strict padded base64 (the prefix is optional) and its decoded bytes are the key. **A secret that is not that dies** (a wiring mistake) instead of failing every delivery as `bad_signature`. Succeeds with `StandardWebhooksVerified { id, timestamp }`.
- **`Sanity.verify(request, { tolerance? })`** — `sanity-webhook-signature`: `t=<unix milliseconds>,v1=<sig>`, an unpadded base64url HMAC-SHA256 over `${t}.` and the body. Succeeds with `SanityVerified { timestamp }`.
- **`HmacHeader.verify(request, { header, encoding, algorithm?, prefix? })`** — a generic HMAC of the body in a caller-named header, for senders whose signed bytes carry no timestamp. `encoding` is `hex` (compared case-insensitively) or `base64`; `algorithm` defaults to `SHA-256`; `prefix` is a literal such as `sha256=`. Covers Linear's bare-hex `linear-signature`.
- **`SharedSecret.verify(request, { header })`** — a secret sent verbatim in a header (Cloudflare's `cf-webhook-auth`), compared through `ConstantTime.secretsEqual`. The raw value is compared, **never trimmed**: `"  secret "` is `bad_signature`; an empty value is `missing_signature`. Succeeds with `void`.
- **`Webhooks.checkFreshness(timestamp, receivedAt, tolerance, preset?)`** — fails `stale_timestamp` unless the timestamp is within tolerance either way. `timestamp` is a `DateTime` or epoch milliseconds; a number no `DateTime` can represent is `stale_timestamp`, never a throw. For a scheme whose timestamp is not in the signed headers (Linear's `webhookTimestamp` is in the JSON body): verify with `HmacHeader` first, decode the body, then call this. `Webhooks.DEFAULT_TOLERANCE` is five minutes, which every timestamped preset uses when `tolerance` is omitted.
- **`WebhookVerificationError`** — one tagged error with `reason`, `preset` (which scheme) and an optional `detail`. Route on `reason`, never on `message`: `missing_signature` (header absent or empty), `malformed` (a required companion header is absent or the wrong shape), `bad_signature` (does not parse or does not match), `stale_timestamp` (signature matches, timestamp outside tolerance). A typical mapping is 401 for `missing_signature` and `bad_signature`, 400 for the others. `detail` never carries the secret, a signature or the body.

## Rules the package enforces

- The signature is always checked **before** the timestamp, so `stale_timestamp` is only ever reported for an authentic delivery.
- Every comparison is constant-time (`ConstantTime` from `@effected/crypto`).
- The body is raw bytes. Verify before parsing; a parsed-then-reserialized body will not match.
- A scheme with no timestamp in the signed bytes (GitHub, `HmacHeader`) cannot reject a replay: deduplicate on the sender's delivery id.

## Usage

```ts
import { Stripe, type WebhookRequest } from "@effected/webhooks";
import { DateTime, Effect, Option, Redacted } from "effect";

const verifyStripe = (headers: Headers, body: Uint8Array, secret: string) => {
  const request: WebhookRequest = {
    header: (name) => Option.fromNullishOr(headers.get(name)),
    body,
    receivedAt: DateTime.nowUnsafe(),
    secret: Redacted.make(secret),
  };
  return Stripe.verify(request, { tolerance: "10 minutes" }).pipe(
    Effect.catchTag("WebhookVerificationError", (error) =>
      Effect.succeed(error.reason === "stale_timestamp" || error.reason === "malformed" ? 400 : 401),
    ),
  );
};
```

## Where it is used

It is the inbound counterpart to the outbound HTTP kit: an Effect service on a Worker or a Node server verifies a delivery here, then decodes the body with its own schema. The HMAC and constant-time primitives it composes live in `@effected/crypto`.

## Not included

A framework or `effect/http` middleware adapter, body parsing, replay storage or deduplication, and schemes outside the six presets (add one with `HmacHeader` or `Hmac` directly).
