---
id: "0007"
title: "effect: JoseError gains a CryptoFailed reason, so an exhaustive switch over its reasons stops compiling"
kind: breaking
shows: typed
applies:
  "effect": ">=4.1.6"
detect: ["JoseError|InvalidKey"]
---

`effect/jose` now reports a crypto backend failure other than a rejected key, such as an algorithm the signing or encryption provider does not support, as the new `JoseError` reason `CryptoFailed`. Before, every backend failure arrived as `InvalidKey`. A rejected key is still `InvalidKey`.

Search for code that switches or matches on a `JoseError`'s `reason._tag`. An exhaustive `switch` with no `default` now fails with "Function lacks ending return statement" (TS2366), and a `Match.exhaustive` fails to typecheck. Add a `CryptoFailed` case. It carries `description`, `module`, `method` and `reason` (the backend `CryptoError` reason tag); its message is the description followed by `(module.method: reason)`, and the backend's own cause is deliberately left out because it may hold secret material. Code that treated `InvalidKey` as "any key problem" should treat `CryptoFailed` the same way unless it needs to tell the two apart. Check the reason union in the installed `effect/jose/JoseError` `.d.ts`.
