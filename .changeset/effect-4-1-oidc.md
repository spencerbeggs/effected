---
"@effected/oidc": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

`Oidc.verify` now verifies on core `effect/jose` through `@effected/jwt`, and requires core's `Signature` service alongside `JwksResolver`:

```ts
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

`Oidc.decodeUnverified` needs no service, and now requires the payload to be a JSON object. The `JwtError` reasons it and `Oidc.verify` fail with follow `@effected/jwt`'s: `alg: "none"` is `malformed`, and claims are checked in core's order.
