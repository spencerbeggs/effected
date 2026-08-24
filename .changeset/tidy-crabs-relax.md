---
"@effected/package-json": minor
---

## Features

Adds `LenientManifest`, a shape-lenient discovery tier for package.json documents, below the existing `PackageManifest` in the tolerance ladder — for sniffing a fetched tarball's manifest or walking a `node_modules` tree, where the document is other people's data and one malformed field must not fail the whole read.

Every field shares its name with the strict `Package` model but is typed as its plain permissive JSON shape (`name`/`version` are any string, dependency maps are plain records). A field present but not even that shape degrades to absence, is preserved verbatim under `rest`, and is reported as a `LenientFieldIssue` on `issues`. Leniency is per-field, not per-syntax — non-JSON text and non-object values still fail typed:

```ts
import { LenientManifest } from "@effected/package-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const sniffed = yield* LenientManifest.decode({ name: "JSONStream", version: "1.0", license: 42 });
	console.log(sniffed.name, sniffed.version); // "JSONStream" "1.0"
	console.log(sniffed.issues); // [{ field: "license", expected: "a string", value: 42 }]
	console.log(sniffed.rest?.license); // 42 — degraded, preserved verbatim
});
```

`decodeResult`/`parseResult` are the synchronous `Result` primitives; `decode`/`parse` are their `Effect.fn`-spanned forms. An empty `issues` array does not imply the document would pass the strict tiers — re-decode the original input through `PackageManifest.decode` or `Package.decode` when validation is actually needed.
