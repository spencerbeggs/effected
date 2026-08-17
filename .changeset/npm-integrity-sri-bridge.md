---
"@effected/npm": minor
---

## Features

`CorepackIntegrityHash` gains a bridge between npm's SRI integrity form and corepack's own spelling, via a new `FromSri` codec and its `fromSri` `Effect` convenience:

```ts
import { CorepackIntegrityHash } from "@effected/npm";

// npm registry SRI form -> corepack packageManager pin form
CorepackIntegrityHash.fromSri("sha512-3q2+7w==...");
// Effect.succeed("sha512.deadbeef...")
```

`fromSri` converts npm's registry `sha512-<base64>` SRI form (what `NpmRegistry.version()` returns) into the corepack `sha512.<hex>` form a `packageManager` pin carries. It tolerates one layer of surrounding JSON quotes and fails typed with the new `InvalidSriIntegrityHashError` on any non-sha512 algorithm, non-canonical base64, a digest that isn't 64 bytes, or an input already in corepack form — the conversion is deliberately one-way from SRI. Encoding through the codec emits the canonical padded SRI spelling.
