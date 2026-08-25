---
"@effected/jsonc": minor
---

## Features

Adds the `JsoncFingerprint` module: canonical JSON serialization (RFC 8785, the JSON Canonicalization Scheme) and SHA-256 content fingerprints over it.

`canonicalizeResult` (sync `Result`) and `canonicalize` (`Effect`) serialize a JSON value to compact, key-sorted canonical text, failing typed with `JsoncCanonicalizeError` on any value that isn't representable — deliberately stricter than `Jsonc.stringify`'s drop/null semantics, since a fingerprint of a silently altered document would be a lie:

```ts
import { JsoncFingerprint } from "@effected/jsonc";
import { Result } from "effect";

const ok = JsoncFingerprint.canonicalizeResult({ b: 2, a: 1 });
if (Result.isSuccess(ok)) {
	console.log(ok.success); // => '{"a":1,"b":2}'
}
```

`hash` and `hashText` compute the content fingerprint — a 64-character lowercase-hex SHA-256 digest with no algorithm prefix — of a JSON value or of raw text, via core's `Crypto.Crypto` service:

```ts
import { JsoncFingerprint } from "@effected/jsonc";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	// Key order never matters: both values fingerprint identically.
	const a = yield* JsoncFingerprint.hash({ b: 2, a: 1 });
	const b = yield* JsoncFingerprint.hash({ a: 1, b: 2 });
	return a === b; // true
});
// Provide a Crypto layer at the edge, e.g. NodeCrypto.layer from "@effect/platform-node".
```

`hashText` accepts a `normalizeEol` option to make file-content hashes stable across checkout line-ending settings; `JsoncFingerprint.normalizeEol` exposes the same normalization as a standalone pure function.
