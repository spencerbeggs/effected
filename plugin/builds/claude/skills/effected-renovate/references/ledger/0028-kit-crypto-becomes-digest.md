---
id: "0028"
title: Kit APIs that required Crypto now require Digest
kind: breaking
shows: typed
applies:
  "@effected/crypto": ">=0.4.0"
  "@effected/jsonc": ">=0.22.0"
  "@effected/images": ">=0.8.0"
  "@effected/npm": ">=0.29.0"
  "@effected/github-actions": ">=0.30.0"
detect: ["SigV4\\.(sign|canonicalize)", "Fingerprint\\.of", "JsoncFingerprint\\.(hash|hashText)[^R]", "ImageCacheKey", "\"digest\"", "integrityUnverifiable", "Package(Tarball|Publish)\\.layer", "BlobStore\\.layerS3", "NodeCrypto\\.layer[^A-Za-z]"]
---

Effect 4.1 removed the root `Crypto` service. Every kit API that required it now requires core's `Digest.Digest` (`import { Digest } from "effect/crypto"`) in `R`. Core's digest cannot fail with a typed error, so `PlatformError` leaves every signature that carried it only for the digest. Hashes are byte-identical to before.

**What you provide changes.** Where you provided `NodeCrypto.layer` or another `Crypto` layer, provide a `Digest` layer: core's `Digest.layerWebCrypto` (any WebCrypto runtime, Workers included) or `@effect/platform-node`'s `NodeCrypto.layerDigest`. `NodeServices.layer` carries no crypto, so a program that leaned on it gets a compile error naming `Digest`.

Per package:

- **`@effected/crypto`:** `SigV4.canonicalize`, `SigV4.sign` and `Fingerprint.of` require `Digest.Digest` and no longer fail with `PlatformError`; a `catchTag("PlatformError")` on them stops compiling. HMAC moved too (entry 0029).
- **`@effected/jsonc`:** `JsoncFingerprint.hash` and `hashText` require `Digest.Digest`; `hashText`'s error channel is `never`. `hashResult` and `hashTextResult` are unchanged.
- **`@effected/images`:** `ImageCacheKey.fromParams` requires `Digest.Digest`, and `ImageCacheKeyError.reason` loses `"digest"`, so a `case "digest"` stops compiling. The `./cache` entry is no longer satisfied by `NodeServices.layer` alone: add `NodeCrypto.layerDigest`.
- **`@effected/npm`:** `PackageTarball.layer` and `PackagePublish.layer` require `Digest.Digest`. `TarballError.reason` loses `"integrityUnverifiable"`: a digest that cannot be computed is now a **defect**, not a typed failure (behavioural; it is still never reported as an integrity mismatch, and the bytes still never reach `tar`).
- **`@effected/github-actions`:** `BlobStore.layerS3` requires `Digest.Digest`. `ActionServices` gains `Digest.Digest` and `SecureRandom.SecureRandom`, and `ActionRuntime.layer` provides both, so an action run through `Action.run` needs no change. A hand-composed `layerS3` must provide `Digest`.

**Test doubles:** a hand-built `Crypto.make` double becomes `Layer.mock(Digest.Digest, { digestHex })`, or provide the real `Digest.layerWebCrypto`.

How it shows itself: compile errors naming `Digest`, a stale `PlatformError` catch, or a removed reason case. Without `crypto.subtle`, `Digest.layerWebCrypto` still builds but a SHA digest dies. Check each signature against the package's installed `.d.ts`.
