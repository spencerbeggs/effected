---
id: "0020"
title: "@effected/crypto: Hash.digest hashes a multi-part message with Hmac.sign's parts and encodings"
kind: adopt
shows: none
applies:
  "@effected/crypto": ">=0.6.0"
detect: ["sha256Hex", "Digest\\.digest"]
closes: ["spencerbeggs/effected#1212"]
---

Offer this to the user; never apply it unasked. It replaces a local helper that UTF-8-encodes a prefix and a body, joins them and calls core `Digest`.

`Hash.digest({ algorithm, message, encoding })` needs core `Digest.Digest` in `R` and cannot fail.

- **`algorithm`** is `MD5`, `SHA-1`, `SHA-256`, `SHA-384` or `SHA-512`.
- **`message`** takes the same forms as `Hmac.sign`: bytes, a string, or a list of either, joined in order.
- **`encoding`** is `bytes` (the default), `hex`, `base64` or `base64url`.

The output is byte-identical to `createHash(...).update(a).update(b)` from `node:crypto`, on both the WebCrypto and the Node digest layers.

If a digest is persisted, such as an archive key, pin the existing values as literals in a test before swapping the helper. Read the installed `.d.ts` for the exact shapes.
