---
id: "0019"
title: "@effected/jwt: a crypto backend that cannot use a key fails as reason key, with a longer message"
kind: behaviour
shows: behavioural
applies:
  "@effected/jwt": ">=0.11.1"
detect: ["JwtError"]
changesets: ["effect-4-1-6-jwt"]
---

Under Effect 4.1.6, core reports a crypto backend failure that is not a rejected key (an algorithm the provider does not support) as `JoseError` `CryptoFailed` instead of `InvalidKey`. `@effected/jwt` routes it to `JwtError` reason `key`, exactly as before, so code that routes on `reason` is unaffected. The error's message now ends with the backend's `(module.method: reason)`, for example `(Signature.verify: Unsupported)`, and core's `JoseError` still rides on `cause`.

Search for code that handles `JwtError`. Route on `reason`, never on `message`: a snapshot or assertion on the message text for this case changes. If code inspects `cause`, a `JoseError` reason `_tag` of `CryptoFailed` is now possible there (see the `effect` entry on `CryptoFailed`). Check the installed `.d.ts`.
