# @effected/toml

TOML 1.0.0 parsing, editing and formatting as Effect schemas on a from-scratch engine (the one format package with no vendored code): parse to plain values or a byte-exact linear CST, compute comment-preserving edits, format, modify by path, visit as a `Stream`. Pure tier: peers only on `effect`, zero runtime deps.

## Import

```ts
import { Toml, TomlDocument, TomlFormat, TomlVisitor } from "@effected/toml";
```

Single entrypoint; no subpaths.

## Core API

- **`Toml`** (facade) — `parse(text)` → `Effect<unknown, TomlParseError>`; `stringify(value, options?)` → `Effect<string, TomlStringifyError>`; schema factories `Toml.schema(target)`, `Toml.fromString`, and the `Toml.TomlFromString` singleton. `TomlStringifyOptions` has exactly one knob (`newline`); there is NO `TomlParseOptions` — TOML 1.0.0 parsing has no knobs.
- **`TomlDocument`** — the lossless document: `parse`, `schema()`, `toValue()`, `stringify()`; carries `source`, `expressions`, `diagnostics`.
- **`TomlEdit`** + `applyAll`, **`TomlFormat`** (`format`/`formatToString` pure and total; `modify`/`modifyToString` → `Effect<_, TomlParseError | TomlModificationError>`) — edit vocabulary parity-identical in shape to jsonc/yaml.
- **`TomlVisitor`** — `Stream<TomlVisitorEvent, TomlParseError>` (`TableStart`/`ArrayTableStart`/`KeyValue`/`Comment`).
- **Date-time value objects** — `TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime`: four `Schema.Class`es with real Gregorian validation; none subclasses JS `Date`.
- **`TomlDiagnostic`** — `code`, `message`, `offset`/`length`, `line`/`character`, five staged error-code unions.

## Usage

```ts
import { Toml } from "@effected/toml";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 return yield* Toml.parse('title = "example"\n[owner]\nname = "Tom"\n');
});
```

```ts
// duplicate keys / table redefinition fail through the typed channel
const error = Effect.runSync(Effect.flip(Toml.parse("a = 1\na = 2\n")));
```

## Testing machinery

None exported (differential testing against `smol-toml` and the toml-test corpus is internal).

## Gotchas

- Integers split `number`/`bigint` at `±(2^53 − 1)`; 64-bit overflow fails `IntegerOutOfRange`.
- An integral float (`1.0`) stringifies as `1` — indistinguishable from an integer on round-trip; shared limitation of every JS TOML emitter, deliberately not papered over with a wrapper type.
- `U+FFFD` is rejected as `InvalidUtf8` on purpose (corpus-compliant deviation from RFC 3629) — do not "fix".
- `TomlEdit.applyAll` rejects overlapping edits as a defect (yaml's does not).
- Only genuinely recursive structures (arrays, inline tables) hit the 256 depth cap; table-header/dotted-key nesting is iterative and deliberately uncapped.
