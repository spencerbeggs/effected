# @effected/webhooks

## 0.6.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.6.0 | 0.7.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

#### `SharedSecret.attest` and `SharedSecret.verifyAttested`

- A shared-secret vendor's "signature" is the route secret itself, so an archive of raw deliveries must never keep that header, and without it an archived delivery cannot be re-verified on replay. `attest` mints a proof to archive in its place, and `verifyAttested` accepts either the live secret or that proof.

```ts
import type { WebhookRequest } from "@effected/webhooks";
import { SharedSecret } from "@effected/webhooks";
import { Effect } from "effect";

const route = { header: "cf-webhook-auth", attestation: "x-archive-attestation", context: ["cloudflare", "production"] };

// On arrival: verify the live secret, then mint the attestation to archive instead of the secret header.
const receive = (delivery: WebhookRequest) =>
  Effect.gen(function* () {
    yield* SharedSecret.verify(delivery, { header: route.header });
    return yield* SharedSecret.attest(delivery, { context: route.context });
  });

// On arrival or on replay: the live secret when the delivery carries it, else the archived attestation.
const verifyRoute = (delivery: WebhookRequest) => SharedSecret.verifyAttested(delivery, route);
```

- When the delivery carries `header` with a non-empty value, the live secret decides, and a wrong one fails even beside a valid attestation
- A `context` part that is empty or contains `.` fails with the new typed `AttestationContextError`
- Attestations from a local scheme will not verify, because the signed prefix is `effected-attestation.v1.<count>.<part>.<part>.` and no `context` value can reproduce another one. Keep the old verifier for deliveries archived before the switch, or re-attest the archive [#1250][#1250]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.5.0 | 0.6.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1250]: https://github.com/spencerbeggs/effected/pull/1250

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.4.0 | 0.5.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229

## 0.3.0

### Breaking Changes

- Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

#### Every preset requires core Mac

- `@effected/crypto` now takes its HMAC from core's `Mac.Mac` (from `effect/crypto`), so `GitHub.verify`, `Stripe.verify`, `StandardWebhooks.verify`, `Sanity.verify`, `HmacHeader.verify` and `SharedSecret.verify` require `Mac.Mac` in `R`. Provide `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (any WebCrypto runtime, Workers included) or `NodeCrypto.layerMac` from `@effect/platform-node`. The error channel is unchanged: every preset fails only with `WebhookVerificationError`, and a crypto failure stays a defect. `Webhooks.checkFreshness` needs nothing. [#1168][#1168]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.3.0 | 0.4.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.2.1 | 0.3.0 |

### Maintenance

- Upgrades core Effect library dependencies to v4.0.7 [#1145][#1145]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1145]: https://github.com/spencerbeggs/effected/pull/1145

## 0.1.3

### Refactoring

- Exports that carry statics now declare real signatures instead of `typeof` the local value, so the published declarations and API docs show them. There is no runtime or call-shape change. [#1101][#1101]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.2.0 | 0.2.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1101]: https://github.com/spencerbeggs/effected/pull/1101

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.1.1 | 0.2.0 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.1.0 | 0.1.1 |

### Other

- Patch release to verify OIDC publishing with GitHub.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

#### New package: `@effected/webhooks`

- Inbound webhook signature verification as presets over `@effected/crypto`. Ships verifiers for GitHub, Stripe, Standard Webhooks (Svix), Sanity, a generic HMAC-header scheme (`HmacHeader`) and a shared-secret scheme (`SharedSecret`), each cross-checked against the `svix` and `stripe` libraries' own signing. The signature is always checked before the timestamp, and staleness is judged against the caller's receive time. A request is described once as a `WebhookRequest` and a rejected one fails with a typed `WebhookVerificationError`, so a handler never has to inspect headers or compare signatures itself. [#1051][#1051]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/crypto | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1051]: https://github.com/spencerbeggs/effected/pull/1051
