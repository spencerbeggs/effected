---
"@effected/toml": minor
---

## Breaking Changes

### `TrailingCommaInInlineTable` and `NewlineInInlineTable` error codes removed

Both codes left `TomlParseErrorCode` and the aggregate `TomlErrorCode`. The
constructs they rejected — a trailing comma before `}` and a newline inside
`{ ... }` — are legal in TOML 1.1.0, so nothing produces either code any
more. They are gone from the public union rather than kept as unreachable
members, so a `switch` over `TomlParseErrorCode` that still names them no
longer typechecks:

```ts
// Before — both arms reachable under the 1.0 parser
switch (diagnostic.code) {
	case "TrailingCommaInInlineTable":
	case "NewlineInInlineTable":
		return "malformed inline table";
}

// After — delete both arms; the input they flagged now parses
```

This is a pre-`0.1.0` change; nothing built on the old union has been
published.

## Features

### TOML 1.1.0 parsing, in place

`Toml.parse` accepts the full TOML 1.1.0 grammar (the spec released
2025-12-24) unconditionally. There is no spec-version option and no opt-in:
1.0 documents are a subset of what the parser already took, so existing input
keeps parsing to the same values.

Four grammar additions come with it:

```toml
esc = "\e[1m"              # \e — the escape character, U+001B
byte = "\xF6"              # \xHH — a two-hex-digit escape over U+0000-U+00FF

table = {
	# newlines, comments and a trailing comma are all legal inside { }
	name = "Alice",
	age = 30,
}

start = 07:32               # seconds are optional and materialize as 0
stamp = 1979-05-27T07:32Z
```

Seconds are optional in both times and date-times, and a missing seconds
field decodes as second `0`. The fractional part nests inside the seconds
group in the grammar, so dropping seconds while keeping a fraction stays an
error:

```ts
const bad = Toml.parse("t = 07:32.5");
// fails with TomlParseError — a secfrac requires its seconds
```

Writes stay conservative. `Toml.stringify` keeps emitting 1.0 spellings —
always explicit seconds, single-line inline tables, and `\u001B` rather
than `\e` for the escape character — all of which are valid 1.1.0, so
output remains readable by 1.0-only consumers.

The conformance corpus moved with the parser: the vendored toml-test fixtures
are now the upstream `files-toml-1.1.0` subset, 214 valid and 467 invalid
files, passing at 100% with no skip list.

### `Toml.bind` for pre-bound domain codecs

`Toml.bind(target)` composes a target schema with the TOML codec once and
returns a `TomlBoundCodec` — the composed `schema` plus `decode` and `encode`
derived from it — so call sites need no generic `Schema` machinery:

```ts
import { Toml } from "@effected/toml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ name: Schema.String });
const config = Toml.bind(Config);

const program = Effect.gen(function* () {
	const value = yield* config.decode('name = "Alice"');
	// { name: "Alice" }
	return yield* config.encode(value);
	// 'name = "Alice"\n'
});
```

Both directions fail with `Schema.SchemaError`, exactly as
`Schema.decodeEffect` / `Schema.encodeEffect` over `Toml.schema(target)`
would, and the target's decoding and encoding service requirements flow
through. `bind` is schema-producing — each call composes a fresh schema and
derives both directions from it — so bind the result to a `const` and reuse
it; that single binding is the point.
