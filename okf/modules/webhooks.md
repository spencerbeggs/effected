---
type: Module
title: "@effected/webhooks"
description: Inbound webhook signature verification as pure functions over a header lookup, the raw body and the receive time, with presets for Standard Webhooks, GitHub, Stripe, Sanity, a generic HMAC header and a shared secret.
status: draft
kind: package
resource: ../../packages/webhooks
layer: L2
tags:
  - architecture
  - security
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
  - id: intake-vendors
    resource: https://github.com/savvy-web/build/tree/main/intake/src/vendors
    title: "Intake's vendor verifiers: svix, github, stripe, sanity, linear, cloudflare, coolify"
  - id: intake-route
    resource: https://github.com/savvy-web/build/blob/main/intake/src/VendorRoute.ts
    title: "InboundRequest and the verification-failure status mapping"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-23T01:39:30Z
integrity:
  generated:
    body: 17fc429c98eb7ce9
---

# `@effected/webhooks`

`@effected/webhooks` verifies that an inbound webhook delivery was signed by the sender it claims to come from. It lifts the signature schemes out of the `savvy-web/build` intake service, which implemented each vendor's scheme over its own `node:crypto` HMAC helpers, into one platform-free package built on [`crypto`](crypto.md).[^owner][^intake-vendors]

## Tier and dependencies

Boundary tier, with no `node:` import, so a verifier runs in a Node service or a Workers handler alike. It depends on [`crypto`](crypto.md) as a regular dependency, since that is a pure-function package with no shared-instance contract; `peerDependencies` is `effect`. It takes no HTTP framework: the input is plain data, so it works under core `effect/http`, a Workers `Request`, or a test.

## What stays with the caller

Delivery identity, vendor naming, routing, payload decoding and attestation are the caller's. Intake keeps `InboundRequest`, `Vendor`, `DeliveryId` and its archived-attestation fallback; a verifier returns the parsed parts of the signature (the message id and timestamp where the scheme carries them) and the caller decides what a delivery id is.[^intake-route]

## Input

Every preset's `verify` takes the same four things:

- a header lookup, `(name: string) => Option<string>`, which the preset calls with lower-case names and which returns the value as received; the presets, not the adapter, guarantee that an empty value counts as absent and that signature values are trimmed;
- the raw body as `Uint8Array`, the exact bytes received, never a re-serialized parse;
- the receive time as `DateTime.Utc`, which staleness is judged against, never the wall clock, so a reprocessed delivery verifies as it did on arrival;
- the secret as `Redacted<string>`.

## Presets

| Preset | Header | Signed bytes | Signature | Freshness |
| --- | --- | --- | --- | --- |
| `StandardWebhooks` | `webhook-id`/`-timestamp`/`-signature`, or the `svix-` family; the branded family is read first | `${id}.${timestamp}.` then the body | space-separated `v1,<base64>`; any `v1` may match (secret rotation); other versions ignored | ±300 s by default |
| `GitHub` | `x-hub-signature-256` | the body | `sha256=<hex>`; SHA-1 `x-hub-signature` ignored | none in the scheme |
| `Stripe` | `stripe-signature` | `${t}.` then the body | `t=<s>,v1=<hex>[,v1=…]`; last `t` wins; any `v1` may match; `v0` ignored | ±300 s by default |
| `Sanity` | `sanity-webhook-signature` | `${t}.` then the body | `t=<ms>,v1=<base64url>`; exactly one `v1` | ±300 s by default, `t` in milliseconds |
| `HmacHeader` | caller-named | the body | hex or base64, with an optional caller-named prefix | none; see `checkFreshness` |
| `SharedSecret` | caller-named | n/a | the header value is the secret itself | none |

Secret handling follows the vendor exactly, because getting it wrong produces a valid-looking signature that never matches. Standard Webhooks strips an optional `whsec_` prefix and base64-decodes the rest into key bytes. Stripe uses its `whsec_` secret as the literal key string, undecoded. GitHub, Sanity and `HmacHeader` use the secret's UTF-8 bytes.

Linear signs with a bare hex HMAC over the body, which `HmacHeader` covers, but carries its timestamp inside the JSON body (`webhookTimestamp`, milliseconds). So `Webhooks.checkFreshness(timestamp, receivedAt, tolerance)` is exported on its own, and the caller applies it after decoding the body. It takes the timestamp as a `DateTime` or as epoch milliseconds, and a number no `DateTime` can represent is `stale_timestamp`, never a throw.

`SharedSecret` compares with `ConstantTime.secretsEqual`, so the secret's length does not leak; it covers Cloudflare's `cf-webhook-auth` and a path secret delivered as a header. It compares the raw header value, untrimmed, because trimming would loosen a secret comparison; only an empty value is absent. Like every preset it needs nothing in `R`, and a `CryptoError` is a defect.

`HmacHeader` verifies with `crypto`'s `Hmac.verify`, which decodes the signature and compares bytes, so any spelling that decodes to the right MAC is accepted: hex in either case, and padded base64 that is not the canonical spelling. Core's base64 decoder requires padding, so unpadded base64 does not decode and is `bad_signature`. `GitHub`, `Stripe`, `Sanity` and `StandardWebhooks` compare their encoded signature strings.

## Ordering

The signature is checked before the timestamp, in every preset. A stale delivery with a bad signature reports `bad_signature`, so an attacker learns nothing about the tolerance window from an unsigned probe.

## Errors

`WebhookVerificationError` carries `reason` `missing_signature`, `malformed`, `bad_signature` or `stale_timestamp`, plus the preset name. A signature header that is present but off its grammar (a Stripe header with no `v1`, a GitHub value that is not `sha256=` and 64 lower-case hex digits) is `bad_signature`, as intake and the vendor libraries treat it; `malformed` is for an absent or ill-shaped auxiliary header, such as a Standard Webhooks timestamp that is not `^\d{1,15}$`. A `CryptoError` from `Hmac.sign` or `ConstantTime.secretsEqual` can only mean a missing runtime or a refused key, so it is a defect too, and every preset's `E` is `WebhookVerificationError` alone. The audience is calling code: intake maps `missing_signature` and `bad_signature` to 401 and `malformed` and `stale_timestamp` to 400. A malformed *secret* (a `whsec_` value that is not base64) is a wiring mistake, not an attacker's input, so it is a defect at verify time rather than a typed failure.

## Observability

One named span per preset `verify`, annotated with the preset and the outcome reason; never the secret, the signature or the body.

## Testing

Pure functions, so the suite needs no layer at all. Every `verify` is truly asynchronous (WebCrypto), so a test that forks one and then adjusts `TestClock` needs a latch. Vectors are lifted from intake's suite, which signs with `node:crypto` and cross-checks against the vendors' own libraries (`svix` `Webhook.sign`, `stripe` `constructEvent`); those two libraries become devDependencies here so the cross-check survives the move. Every preset is mutation-tested: each part of the signed string wrong in exactly one way must fail.

## Consumers

`savvy-web/build` intake, for every vendor it receives from.

[^owner]: conversation with the repository owner
[^intake-vendors]: <https://github.com/savvy-web/build/tree/main/intake/src/vendors>
[^intake-route]: <https://github.com/savvy-web/build/blob/main/intake/src/VendorRoute.ts>
