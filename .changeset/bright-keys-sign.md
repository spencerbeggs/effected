---
"@effected/crypto": minor
---

## Features

### New package: `@effected/crypto`

HMAC signing and verification, constant-time comparison and AWS Signature Version 4 request signing, built on WebCrypto with no `node:` import, so they run on Node and Cloudflare Workers alike. `Hmac` signs and verifies messages, `ConstantTime` compares secrets and MACs without leaking where they differ, and `SigV4` signs requests for S3-compatible stores. A missing WebCrypto runtime or a rejected key fails as `CryptoError`; a SigV4 path with a `.` or `..` segment, which a URL would collapse before sending, fails as its own `SigV4PathError` so a caller can recover from it. HMAC comes from WebCrypto; every digest (the SigV4 payload hash, `ConstantTime.secretsEqual`) goes through core `Crypto`, which those operations require in `R`.
