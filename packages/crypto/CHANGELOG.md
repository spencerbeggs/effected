# @effected/crypto

## 0.4.0

### Breaking Changes

- Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

#### Digest replaces Crypto

- Effect 4.1 removed the root `Crypto` service, so `SigV4.canonicalize`, `SigV4.sign` and `Fingerprint.of` now require `Digest.Digest` (from `effect/crypto`) in `R` where they required `Crypto`. They no longer fail with `PlatformError`, so a `catchTag("PlatformError")` on these effects stops compiling. `SigV4.signingKey` is unchanged. Provide `Digest.layerWebCrypto` (any WebCrypto runtime) or `NodeCrypto.layerDigest` from `@effect/platform-node`. Hashes are byte-identical to before.

#### HMAC runs on core Mac, and core's CryptoError replaces this package's

- Every HMAC now goes through core's `Mac.Mac` (from `effect/crypto`), required in `R`: `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual` and `SigV4.signingKey` require `Mac.Mac`, and `SigV4.sign` requires `Mac.Mac` beside `Digest.Digest`. Provide `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto` (any WebCrypto runtime) or `NodeCrypto.layerMac` from `@effect/platform-node`. Tags and SigV4 signatures are byte-identical to before.

- `CryptoError` and `CryptoErrorReason` are removed. The error channel is core's `CryptoError` from `effect/crypto`; its tag is still `"CryptoError"`, but `reason` is a tagged object (`InvalidKey` for an empty key) rather than the strings `"unsupportedRuntime"` and `"key"`.

- A runtime with no `crypto.subtle` no longer fails with `unsupportedRuntime`: on `Mac.layerWebCrypto` the HMAC dies, as a digest already did.

- `Hmac.verify` and `ConstantTime.secretsEqual` compare through `Mac.verify`, and `ConstantTime.equal` through `Mac.timingSafeEqual`; `ConstantTime.equal` still takes strings and needs nothing in `R`. [#1168][#1168]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.3.0

### Features

- `HttpRedaction` copies HTTP errors with credentials removed, for libraries that keep a request or response as an error cause. It keeps the method, URL, status and headers, replaces the values of `authorization`, cookies and token-style headers with `REDACTED`, redacts URL userinfo and signed-URL query values, and drops the body. `@effected/npm`, `@effected/runtimes`, `@effected/jwt`, `@effected/github` and `@effected/github-actions` use it.

### Bug Fixes

#### Security

- `HttpRedaction.text` runs in linear time. Its URL scan was quadratic on a long run of scheme characters with no `://` (80 KB took seconds), which a large server-sent error body could use to stall the event loop.
- `Bearer`, `Basic` and `token` credentials are matched in any case, so a lowercase `bearer …` no longer survives. A value is redacted only when it reads as a credential, so prose such as "invalid token provided by" is left as written. [#1151][#1151]

### Maintenance

- Upgrades core Effect library dependencies to v4.0.7 [#1145][#1145]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1145]: https://github.com/spencerbeggs/effected/pull/1145

[#1151]: https://github.com/spencerbeggs/effected/pull/1151

## 0.2.1

### Refactoring

- Exports that carry statics now declare real signatures instead of `typeof` the local value, so the published declarations and API docs show them. There is no runtime or call-shape change. [#1101][#1101]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1101]: https://github.com/spencerbeggs/effected/pull/1101

## 0.2.0

### Features

#### Fingerprints and drift decisions

- `Fingerprint` supports reconciling declared configuration against a remote resource. Closes #355.

- `Fingerprint.of(value)` gives the SHA-256 fingerprint of a JSON-shaped value as 64 lowercase hex characters. Keys are sorted at every depth, array order is kept, and `undefined` members are dropped. It requires core's `Crypto.Crypto`.

- `Fingerprint.canonicalizeResult` returns the canonical JSON text that `of` hashes, as a `Result`.

- `Fingerprint.decide({ applied, live, desired })` turns three fingerprints into a `DriftDecision`: `Apply` (`DriftApply`), `Unchanged` (`DriftUnchanged`) or `Drift` (`DriftDetected`, carrying `applied` and `live`).

- A value with no canonical JSON form, such as a bigint or a cycle, fails with `FingerprintError`, whose `path` points at the offending member. [#1098][#1098]

```ts
import { Fingerprint } from "@effected/crypto";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const a = yield* Fingerprint.of({ name: "main", rules: ["a", "b"] });
  const b = yield* Fingerprint.of({ rules: ["a", "b"], name: "main" });
  return a === b; // true: key order is not drift
});
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1098]: https://github.com/spencerbeggs/effected/pull/1098

## 0.1.1

### Other

- Patch release to verify OIDC publishing with GitHub.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

#### New package: `@effected/crypto`

- HMAC signing and verification, constant-time comparison and AWS Signature Version 4 request signing, built on WebCrypto with no `node:` import, so they run on Node and Cloudflare Workers alike. `Hmac` signs and verifies messages, `ConstantTime` compares secrets and MACs without leaking where they differ, and `SigV4` signs requests for S3-compatible stores. A missing WebCrypto runtime or a rejected key fails as `CryptoError`; a SigV4 path with a `.` or `..` segment, which a URL would collapse before sending, fails as its own `SigV4PathError` so a caller can recover from it. HMAC, including the keyed blinding `ConstantTime.secretsEqual` uses, comes from WebCrypto and needs nothing in `R`; the SigV4 payload hash goes through core `Crypto`, which `SigV4.canonicalize` and `SigV4.sign` require in `R`. [#1051][#1051]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1051]: https://github.com/spencerbeggs/effected/pull/1051
