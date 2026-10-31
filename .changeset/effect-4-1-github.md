---
"@effected/github": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

The App JWT is now signed through `@effected/jwt` on core `effect/jose`, so `GitHubApp.layer`, `GitHubApp.layerWith`, `GitHubApp.clientLayer` and `GitHubApp.appClientLayer` require core's `Signature` service, and `ActionsOidc.verify` requires it alongside `JwksResolver`. Provide it once at the edge:

```ts
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
```

The `GitHubApp` methods and the client layers' re-signing still need nothing: the layer captures `Signature` when it is built. The App JWT on the wire is unchanged: header `{"alg":"RS256","typ":"JWT"}`, claims `iat`, `exp` and `iss`, and the same signature bytes for the same key and clock.
