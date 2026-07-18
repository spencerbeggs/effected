---
"@effected/app": patch
---

## Documentation

Corrected the `effect-v4-construct-map` skill's Schema rename reference: the
`decode`/`encode` family is not a blanket sweep. Only the Effect-returning
base names (`decode`/`decodeUnknown`/`encode`/`encodeUnknown` → `*Effect`)
and the `*Either` variants (→ `*Result`/`*Exit`) are renamed; the
`*Sync`/`*Option`/`*Promise` variants survive unchanged, and the typed and
`Unknown` flavors of each differ by input type rather than being
interchangeable. Also notes that `Schema.decode`/`Schema.encode` still exist
in v4, but as transformation combinators rather than parsers.
