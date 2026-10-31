# @effected/webhooks

Inbound webhook signature verification for Effect v4: Standard Webhooks, GitHub, Stripe, Sanity, HMAC header and shared-secret presets.

## What to provide

Every preset's `verify`, `SharedSecret` included, requires core's `Mac.Mac` (`effect/crypto`) in `R`, and fails only with `WebhookVerificationError`. Provide it once at your server's edge:

```ts
import { Layer } from "effect";
import { Mac, SecureRandom } from "effect/crypto";

// Any runtime with WebCrypto: Node, Cloudflare Workers, Deno, Bun.
const MacLive = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

On Node, `NodeCrypto.layerMac` from `@effect/platform-node` runs on `node:crypto` instead. A `CryptoError` from the `Mac` layer is a defect, as is a runtime with no `crypto.subtle` on the WebCrypto layer. `Webhooks.checkFreshness` is pure and needs nothing.
