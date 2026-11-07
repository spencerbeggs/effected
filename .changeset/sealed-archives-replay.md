---
"@effected/webhooks": minor
---

## Features

### `SharedSecret.attest` and `SharedSecret.verifyAttested`

A shared-secret vendor's "signature" is the route secret itself, so an archive of raw deliveries must never keep that header, and without it an archived delivery cannot be re-verified on replay. `attest` mints a proof to archive in its place, and `verifyAttested` accepts either the live secret or that proof.

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

* When the delivery carries `header` with a non-empty value, the live secret decides, and a wrong one fails even beside a valid attestation
* A `context` part that is empty or contains `.` fails with the new typed `AttestationContextError`
* Attestations from a local scheme will not verify, because the signed prefix is `effected-attestation.v1.<count>.<part>.<part>.` and no `context` value can reproduce another one. Keep the old verifier for deliveries archived before the switch, or re-attest the archive
