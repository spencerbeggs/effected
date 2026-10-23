---
"@effected/crypto": minor
---

## Features

### New package: `@effected/crypto`

HMAC signing and verification, constant-time comparison and AWS Signature Version 4 request signing, built on WebCrypto with no `node:` import, so they run on Node and Cloudflare Workers alike. `Hmac` signs and verifies messages, `ConstantTime` compares secrets and MACs without leaking where they differ, and `SigV4` signs requests for S3-compatible stores. Failures surface as a typed `CryptoError`. HMAC comes from WebCrypto; every digest (the SigV4 payload hash, `ConstantTime.secretsEqual`) goes through core `Crypto`, which those operations require in `R`.
