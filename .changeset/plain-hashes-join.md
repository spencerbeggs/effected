---
"@effected/crypto": minor
---

## Features

### `Hash.digest`

The digest counterpart to `Hmac.sign`, over core `Digest.Digest` in `R`. It takes the same messages as `Hmac.sign` (bytes, a string, or a list of either, joined in order) and the same encodings, and it cannot fail. `algorithm` is `MD5`, `SHA-1`, `SHA-256`, `SHA-384` or `SHA-512`. The output is byte-identical to `createHash(...).update(a).update(b)` from `node:crypto`, on both the WebCrypto and the Node digest layers.

```ts
import { Hash } from "@effected/crypto";

const archiveKey = (window: number, body: Uint8Array) =>
  Hash.digest({ algorithm: "SHA-256", message: [`${window}.`, body], encoding: "hex" });
// Effect<string, never, Digest>
```

MD5 and SHA-1 are broken for collision resistance, so use them only to match an existing protocol or checksum.
