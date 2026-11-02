---
id: "0030"
title: The kit's CryptoError is replaced by core's
kind: breaking
shows: typed
applies:
  "@effected/crypto": ">=0.4.0"
detect: ["CryptoErrorReason", "CryptoError[^;]*from \"@effected/crypto", "reason === \"(key|unsupportedRuntime)\""]
---

`@effected/crypto`'s own `CryptoError` and `CryptoErrorReason` are deleted. Its error channel is core's `CryptoError` from `effect/crypto`, which the package does not re-export: import it from `effect/crypto` (`CryptoError.CryptoError`).

The tag is still `"CryptoError"`, so `catchTag("CryptoError", ...)` keeps compiling. But `reason` is now a tagged object, not a string: a check such as `error.reason === "key"` stops compiling and becomes `error.reason._tag === "InvalidKey"`. An empty HMAC key fails with `InvalidKey` (message `Mac.key: An HMAC key cannot be empty`).

How it shows itself: the import and every string comparison on `reason` stop compiling. Check the reason union against the installed `effect/dist/crypto/CryptoError.d.ts`.
