# @effected/webhooks

[![npm](https://img.shields.io/npm/v/@effected%2Fwebhooks?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/webhooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

Verify that an inbound webhook delivery was signed by the sender it claims to come from, for Effect v4. Presets cover Standard Webhooks (Svix, and so Clerk and Resend), GitHub, Stripe and Sanity. A generic HMAC header covers Linear and other bare-HMAC senders, and a shared-secret header covers Cloudflare. Every verifier is a function over plain data (a header lookup, the raw body, the receive time and the secret), with no HTTP framework and no `node:` import, so it runs in a Node server and a Cloudflare Worker alike.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on
> stable Effect v4 and still in `0.x` development. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/webhooks

A webhook signature is an HMAC, and core `effect/crypto`'s `Mac` computes one. The hard part is each vendor's scheme around it, which is easy to get subtly wrong in ways that still look valid:

- **The signed bytes.** Stripe and Sanity sign `${t}.` then the body, and Standard Webhooks signs `${id}.${timestamp}.` then the body. Each must be the raw body bytes, never a re-serialized parse.
- **The secret.** Standard Webhooks base64-decodes its `whsec_` secret into the key. Stripe uses its `whsec_` secret as the literal key string. Swap the two and every signature silently fails to match.
- **The header grammar.** Several `v1` signatures may be present during a secret rotation, `v0` and SHA-1 headers must be ignored, and the last `t` wins.
- **The order.** The signature is checked before the timestamp, so an unsigned probe learns nothing about the tolerance window.
- **The clock.** Staleness is judged against the time you received the delivery, not the wall clock, so a delivery replayed from a queue verifies as it did on arrival.

If you only receive from a sender that HMACs the body with no timestamp, `HmacHeader` here is a few lines, and `Hmac.verify` from [`@effected/crypto`](https://www.npmjs.com/package/@effected/crypto) is the same check one level down. Use core `Mac` alone only when you are comfortable writing the decoding and the constant-time comparison yourself.

## Install

```bash
npm install @effected/webhooks effect
```

```bash
pnpm add @effected/webhooks effect
```

On Node, requires Node.js >=24.11.0; it also runs on any other WebCrypto runtime, Cloudflare Workers included. `effect` v4 is the only peer, and `@effected/crypto` comes with it. All `@effected/*` packages are ESM-only.

## What to provide

| Operation | Requires |
| --- | --- |
| `StandardWebhooks.verify`, `GitHub.verify`, `Stripe.verify`, `Sanity.verify`, `HmacHeader.verify`, `SharedSecret.verify` | `Mac.Mac` |
| `Webhooks.checkFreshness` | nothing |

No verifier needs `Digest` or `SecureRandom` itself; `SecureRandom` is what the WebCrypto `Mac` layer is built on.

| Service | Any WebCrypto runtime (Workers included) | Node |
| --- | --- | --- |
| `Mac.Mac` | `Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto` | `NodeCrypto.layerMac` from `@effect/platform-node` |

```ts
import { Layer } from "effect";
import { Mac, SecureRandom } from "effect/crypto";

const MacLive = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

## Build a `WebhookRequest`

Every verifier takes a `WebhookRequest`: a `header` lookup that the presets call with lower-case names, the raw `body` bytes, the `receivedAt` time as a `DateTime.Utc`, and the endpoint's `secret` as a `Redacted` string, in the form the vendor shows it. Adapting one from a fetch `Request`, as a Worker or any fetch-based server receives it:

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { DateTime, Effect, Option } from "effect";
import type { Redacted } from "effect";

const fromRequest = (request: Request, secret: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const body = new Uint8Array(yield* Effect.promise(() => request.arrayBuffer()));
    const receivedAt = yield* DateTime.now;
    const delivery: WebhookRequest = {
      header: (name) => Option.fromNullishOr(request.headers.get(name)),
      body,
      receivedAt,
      secret,
    };
    return delivery;
  });
// Effect<WebhookRequest>
```

The adapter does not need to trim or filter. The presets treat an empty value as absent, and the signature presets trim the value and treat a whitespace-only one as absent too. When you reprocess a stored delivery, pass its original arrival time as `receivedAt`.

## Verify a delivery

### GitHub

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { GitHub } from "@effected/webhooks";

const verifyGitHub = (delivery: WebhookRequest) => GitHub.verify(delivery);
// Effect<void, WebhookVerificationError, Mac>
```

Checks `x-hub-signature-256`: `sha256=` and the lower-case hex HMAC-SHA256 of the body under the secret's UTF-8 bytes. The SHA-1 `x-hub-signature` is ignored. GitHub signs no timestamp, so a replay looks exactly like a redelivery; deduplicate on `x-github-delivery`.

### Stripe

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { Stripe } from "@effected/webhooks";

const verifyStripe = (delivery: WebhookRequest) => Stripe.verify(delivery, { tolerance: "10 minutes" });
// Effect<StripeVerified, WebhookVerificationError, Mac>
```

Checks `stripe-signature`, a list of `key=value` pairs. The last valid `t` (Unix seconds) wins, any `v1` may match, which covers a secret roll when Stripe signs with both secrets, and `v0` is ignored. The key is the `whsec_` secret string itself, undecoded. `StripeVerified` carries the signed `timestamp`. `tolerance` is any `Duration.Input` and defaults to `Webhooks.DEFAULT_TOLERANCE`, five minutes either way.

### Standard Webhooks (Svix, Clerk, Resend)

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { StandardWebhooks } from "@effected/webhooks";

const verifySvix = (delivery: WebhookRequest) => StandardWebhooks.verify(delivery);
// Effect<StandardWebhooksVerified, WebhookVerificationError, Mac>
```

Reads `svix-id`, `svix-timestamp` and `svix-signature`, each falling back to its unbranded `webhook-` name. The signature header is a space-separated list of `v1,<base64>`, any of which may match. The secret is `whsec_` (the prefix is optional) followed by strict, padded base64, and its decoded bytes are the key. `StandardWebhooksVerified` carries the message `id`, which the sender repeats on every retry, so deduplicate on it, and the signed `timestamp`.

### Sanity

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { Sanity } from "@effected/webhooks";

const verifySanity = (delivery: WebhookRequest) => Sanity.verify(delivery);
// Effect<SanityVerified, WebhookVerificationError, Mac>
```

Checks `sanity-webhook-signature`, `t=<unix milliseconds>,v1=<signature>` with exactly one `v1`: the unpadded base64url HMAC-SHA256 of `${t}.` and the body, under the secret's UTF-8 bytes. Note that `t` is in milliseconds, unlike Stripe's. `SanityVerified` carries the signed `timestamp`.

### Linear

There is no Linear preset, because Linear needs none: it signs the body with a bare hex HMAC in `linear-signature`, which `HmacHeader` checks, and puts its timestamp inside the JSON body as `webhookTimestamp`, in milliseconds. Verify the signature, decode the body, then check freshness with `Webhooks.checkFreshness`:

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { HmacHeader, Webhooks } from "@effected/webhooks";
import { Effect, Schema } from "effect";

const LinearPayload = Schema.Struct({ action: Schema.String, webhookTimestamp: Schema.Number });

const verifyLinear = (delivery: WebhookRequest) =>
  Effect.gen(function* () {
    yield* HmacHeader.verify(delivery, { header: "linear-signature", encoding: "hex" });
    const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LinearPayload))(
      new TextDecoder().decode(delivery.body),
    );
    yield* Webhooks.checkFreshness(payload.webhookTimestamp, delivery.receivedAt, Webhooks.DEFAULT_TOLERANCE);
    return payload;
  });
// Effect<{ readonly action: string; readonly webhookTimestamp: number }, WebhookVerificationError | SchemaError, Mac>
```

`checkFreshness` takes a `DateTime` or epoch milliseconds. A number no `DateTime` can represent (out of range, `NaN`, infinite) is `stale_timestamp`, never a throw, so a sender-supplied value can go straight in. An optional fourth argument names the preset on the error; it defaults to `HmacHeader`.

### A custom HMAC header

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { HmacHeader } from "@effected/webhooks";

const verifyCustom = (delivery: WebhookRequest) =>
  HmacHeader.verify(delivery, { header: "x-signature", encoding: "base64", algorithm: "SHA-512", prefix: "sha512=" });
// Effect<void, WebhookVerificationError, Mac>
```

For any sender that HMACs the body alone under the secret's UTF-8 bytes. `header` is the lower-case header name, `encoding` is `hex` or padded `base64`, `algorithm` is `SHA-256` (the default) or `SHA-512`, and `prefix` is a literal the value starts with. The signature is decoded and compared as bytes, so hex in either case verifies; unpadded base64 does not decode and is `bad_signature`. The four vendor presets instead compare the encoded strings, because their senders write only one spelling.

### A shared secret

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { SharedSecret } from "@effected/webhooks";

const verifyCloudflare = (delivery: WebhookRequest) => SharedSecret.verify(delivery, { header: "cf-webhook-auth" });
// Effect<void, WebhookVerificationError, Mac>
```

For a sender that puts the secret itself in a header, such as Cloudflare's `cf-webhook-auth`, or a path secret your proxy moves into one. It compares with `ConstantTime.secretsEqual` from `@effected/crypto`, which MACs both sides under a fresh key first, so neither the secret's length nor a matching prefix leaks. That is why it needs `Mac` too. The value is compared exactly as the lookup returns it, never trimmed, because trimming would loosen a secret comparison. A fetch `Request`'s `Headers` already strips surrounding whitespace before your lookup sees it, so through the adapter above a padded secret matches.

## Errors

Every verifier fails with `WebhookVerificationError` alone. It carries `reason`, the routing key; `preset`, the scheme being verified (`StandardWebhooks`, `GitHub`, `Stripe`, `Sanity`, `HmacHeader` or `SharedSecret`); and an optional human-readable `detail`. Route on `reason`, never on `message` or `detail`, which never carry the secret, a signature or the body.

| `reason` | Meaning | Typical status |
| --- | --- | --- |
| `missing_signature` | The signature header, or for `SharedSecret` the secret header, is absent or empty. | 401 |
| `bad_signature` | No signature matches, or the signature header is present but off its grammar: a GitHub value that is not `sha256=` and 64 lower-case hex digits, a Stripe header with no `t` or no `v1`, a Sanity header that is not `t=<ms>,v1=<sig>`, a missing `HmacHeader` prefix, or a signature that does not decode. | 401 |
| `malformed` | A header the scheme needs besides the signature is absent or ill-shaped: a Standard Webhooks id or timestamp, or a timestamp that is not 1 to 15 digits of Unix seconds. | 400 |
| `stale_timestamp` | The signature matches, but the signed timestamp sits outside the tolerance of `receivedAt`, either way. The boundary counts as fresh. | 400 |

```ts
import type { WebhookVerificationError } from "@effected/webhooks";

const statusFor = (error: WebhookVerificationError): 400 | 401 =>
  error.reason === "missing_signature" || error.reason === "bad_signature" ? 401 : 400;
```

Because the signature is checked first, a stale delivery with a bad signature reports `bad_signature`. A wiring mistake is a defect, not a typed failure: a Standard Webhooks secret that is not `whsec_` base64, an empty secret for an HMAC preset (which core `Mac` refuses as `InvalidKey`), or a `CryptoError` from a misbehaving `Mac` layer. On the WebCrypto layer, a runtime with no `crypto.subtle` dies too. `WebhookVerificationReason` and `WebhookPreset` are exported as schemas.

## Testing

The package ships no test double. Provide `MacLive` from [What to provide](#what-to-provide) and build the delivery in the test, signing it with an implementation other than the one under test, such as `node:crypto`'s `createHmac`, or the vendor's own SDK where one exists (`stripe`'s `generateTestHeaderString`, `svix`'s `Webhook.sign`). Pass a fixed `receivedAt` and sign with a timestamp relative to it, and no test needs `TestClock`. On `Mac.layerWebCrypto` every `verify` awaits a real promise, so a test that forks one and then adjusts `TestClock` can hang: await it, or gate the clock on a latch. Test the failure paths as well as the happy one: change each part of the signed bytes in exactly one way and assert `bad_signature`.

## What it does not do

- **Decide delivery identity.** It returns the parts of the signature (the message id and timestamp where the scheme has them); deduplication, routing and vendor naming are yours.
- **Decode the payload.** Decode the verified `body` with your own schema.
- **Wrap an HTTP framework.** The input is plain data, so it fits core `effect/http`, a Workers `Request` or a test without an adapter package.
- **Read the wall clock.** Freshness is always judged against the `receivedAt` you pass.

## License

[MIT](LICENSE)
