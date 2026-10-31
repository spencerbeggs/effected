# @effected/crypto

HMAC, constant-time comparison and AWS SigV4 request signing on Effect v4's core `effect/crypto` services, safe for Workers.

`Fingerprint.of(value)` gives a stable SHA-256 fingerprint of a JSON-shaped value (keys sorted at every depth, array order kept, `undefined` members dropped), and `Fingerprint.decide({ applied, live, desired })` turns three fingerprints into an `Apply`, `Unchanged` or `Drift` decision for reconciling declared config against a remote.

## What to provide

The keyed and hashing operations require core services in `R`, provided once at your program's edge:

| Operation | Requires |
| --- | --- |
| `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual`, `SigV4.signingKey` | `Mac.Mac` |
| `SigV4.sign` | `Mac.Mac` and `Digest.Digest` |
| `SigV4.canonicalize`, `Fingerprint.of` | `Digest.Digest` |

`ConstantTime.equal`, `SigV4.encodePath`, `Fingerprint.decide` and `HttpRedaction` are pure and need nothing.

On any runtime with WebCrypto (Node, Cloudflare Workers, Deno, Bun, browsers):

```ts
import { Layer } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";

const CryptoLive = Layer.mergeAll(
  Digest.layerWebCrypto,
  Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);
```

On Node, `NodeCrypto.layerMac` and `NodeCrypto.layerDigest` from `@effect/platform-node` run on `node:crypto` instead. `NodeServices.layer` provides neither.

Failures are core's `CryptoError` from `effect/crypto` (for example `InvalidKey` for an empty HMAC key). On the WebCrypto layers, a runtime with no `crypto.subtle` is a defect: the effect dies rather than failing.
