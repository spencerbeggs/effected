---
"@effected/toml": minor
---

## Features

Initial release of `@effected/toml` — TOML 1.0.0 parsing, editing and formatting as pure Effect schemas, on a from-scratch engine: the first format package in the kit with no vendored code. The document model honors TOML's real shape — a lossless *linear* CST whose expression spans tile the source byte-for-byte, with the logical table tree derived by a separate semantic pass — so comment-preserving edits are text splices, not tree surgery. Zero runtime dependencies beyond the `effect` peer; no IO:

```ts
import { Toml, TomlDocument, TomlFormat } from "@effected/toml";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const value = yield* Toml.parse('title = "app"\n[server]\nport = 8080\n');

  const doc = yield* TomlDocument.parse('# deploy config\n[server]\nport = 8080 # keep\n');
  doc.stringify(); // byte-identical to the input — spans, not re-printing

  const edited = yield* TomlFormat.modifyToString(
    '[server]\nport = 8080 # keep\n',
    ["server", "port"],
    9090,
  ); // '[server]\nport = 9090 # keep\n' — the comment survives
});
```

* `Toml.parse` / `Toml.stringify` — values in, canonical TOML out, every failure a typed `TomlParseError` / `TomlStringifyError` carrying positioned `TomlDiagnostic`s (stage-scoped error codes, zero-based line and character). `Toml.TomlFromString` and `Toml.schema` decode config schemas straight from TOML text.
* **Four first-class date-time classes** — `TomlOffsetDateTime`, `TomlLocalDateTime`, `TomlLocalDate`, `TomlLocalTime` — schema-validated (real Gregorian calendars, leap seconds) with structural equality, replacing the `Date`-subclass compromise other parsers make for TOML's local types. Integers decode to `number` inside the safe range and `bigint` beyond it, with 64-bit bounds enforced as typed errors.
* `TomlDocument` — the lossless view: expressions plus semantic diagnostics as data, so syntactically valid but semantically illegal text stays inspectable and editable; `stringify()` reconstructs the source from expression spans, proven byte-exact across the full compliance corpus.
* `TomlEdit` / `TomlFormat` — the jsonc/yaml edit shape (`{ offset, length, content }`), a conservative six-rule formatter that never reorders, never rewrites values and never touches bytes inside multi-line strings, and `modify` for path-addressed set/replace/delete/insert where every result is guaranteed to re-parse.
* `TomlVisitor.visit` — a SAX-style event stream (tables, array-table elements, key-values with full paths, comments) in document order.

### Compliance and verification

The official toml-test corpus (v2.2.0, the TOML 1.0.0 subset: 205 valid and 474 invalid cases) passes at 100% with no skip list, every valid case checked against its expected typed value and every invalid case failing through the typed error channel. A differential property suite cross-checks the engine against `smol-toml` as a test-time oracle — zero divergences — and the byte-exact round-trip is proven over every valid corpus file, CRLF documents included.

### Hardened against hostile input

Value nesting is depth-guarded on every recursion surface — parse, stringify, document, visitor and edit-path resolution — while header and dotted-key depth is handled iteratively as data, so a five-thousand-segment header neither overflows nor trips a guard. Prototype-pollution keys land as own data properties, control characters and invalid escapes are rejected with positioned diagnostics, and megabyte-scale documents parse in linear time. Malformed input always fails typed; genuine defects are never masked as parse errors.
