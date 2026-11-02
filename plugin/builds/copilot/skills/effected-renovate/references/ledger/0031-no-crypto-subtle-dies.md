---
id: "0031"
title: HMAC without crypto.subtle now dies instead of failing
kind: behaviour
shows: behavioural
applies:
  "@effected/crypto": ">=0.4.0"
  "@effected/webhooks": ">=0.3.0"
  "@effected/github-actions": ">=0.30.0"
detect: ["unsupportedRuntime", "globalThis\\.crypto"]
---

Where the kit's HMAC used to fail with `CryptoError { reason: "unsupportedRuntime" }`, `Mac.layerWebCrypto` on a runtime without `crypto.subtle` now builds, and the HMAC **dies**, as a SHA digest already did. A recovery from `unsupportedRuntime` never runs again; it is a defect now. Remove the dead recovery, and make sure the runtime has WebCrypto, or provide `NodeCrypto.layerMac`.

**Test doubles:** a test that stubbed `globalThis.crypto` to reach `unsupportedRuntime` provides a `Mac` layer over a stubbed `WebCrypto.layer` instead, and asserts a defect rather than a typed failure.

How it shows itself: only tests find it, as a failing assertion on the error channel or a defect where a failure was expected.
