---
"@effected/toml": minor
---

## Features

Zero-dependency TOML 1.0.0 parsing, editing and formatting expressed as Effect schemas and pure functions. The engine is written from scratch against the TOML 1.0.0 spec — the only format package in the repo that vendors no upstream code — and parses into a lossless linear CST whose expression spans tile the source byte-exact, so `TomlDocument.parse(text).stringify()` reproduces the original text exactly for any valid document. `effect` is the only runtime dependency.

### Decode straight into a domain schema

`Toml.schema` composes with your own `Schema`; `Toml.stringify` emits canonical TOML.

```ts
import { Toml } from "@effected/toml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ name: Schema.String, port: Schema.Number });
const ConfigFromToml = Toml.schema(Config);

const program = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(ConfigFromToml)(`
    name = "api"
    port = 3000
  `);
});

Effect.runPromise(program).then(console.log);
// { name: "api", port: 3000 }
```

### Editing without losing comments

`TomlFormat.modify` computes a `TomlEdit` array against the parsed CST; `modifyToString` applies it in one step. Comments, blank lines and layout an edit does not cover come through byte-identical.

```ts
import { TomlFormat } from "@effected/toml";
import { Effect } from "effect";

const source = `# server config
name = "api"
port = 3000 # dev default
`;

Effect.runPromise(TomlFormat.modifyToString(source, ["port"], 8080)).then(console.log);
// # server config
// name = "api"
// port = 8080 # dev default
```

### An honest value model

Integers past ±(2^53 − 1) decode to `bigint` instead of silently losing precision, and TOML's four date-time types decode to calendar-validated `Schema.Class` value objects — `TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime` — instead of a `Date` that cannot represent a local time. TOML has no null, so `Toml.stringify` on a value containing `null` fails with a structured `UnsupportedValue` diagnostic naming the offending path rather than dropping the key. Every fallible entry point carries a typed error built from `TomlDiagnostic`, with nesting-depth guards so hostile input fails through that channel rather than as a stack overflow. `TomlVisitor` walks a document as a `Stream` of visitor events.
