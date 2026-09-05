# @effected/toml

## 0.6.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `Toml` and `TomlDocument`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.3.2

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.3.0

### Features

- ### `Toml.parseResult` and `Toml.stringifyResult`: the synchronous `Result` primitives
  TOML parsing and stringification are pure synchronous computation, so the `Effect` wrapper on `Toml.parse` and `Toml.stringify` carried nothing but a tracing span and the error channel. Synchronous callers — a lint-staged handler, a non-Effect config loader — had to build a runtime and write `Effect.runSync(Effect.result(...))` to reach an engine that never suspends.

  Both entry points now have a sync twin returning `Result` directly:
  ```ts
  import { Toml } from "@effected/toml";
  import { Result } from "effect";

  const parsed = Toml.parseResult('name = "Alice"');
  if (Result.isSuccess(parsed)) {
  	console.log(parsed.success); // => { name: "Alice" }
  }

  const text = Toml.stringifyResult({ name: "Alice" });
  ```
  `parseResult` returns `Result<unknown, TomlParseError>` and `stringifyResult` returns `Result<string, TomlStringifyError>`, with the same `TomlStringifyOptions` parameter — the same values, the same typed errors and the same diagnostics the `Effect` forms already produced.

  This follows the kit's sync-primitive convention, matching `Jsonc.parseResult` / `Jsonc.stringifyResult` and `Markdown.parseResult` / `Markdown.stringifyResult`. `Toml.parse` and `Toml.stringify` are unchanged in signature, error channel and span, and are now defined as `Effect.fromResult(Toml.parseResult(...))` and `Effect.fromResult(Toml.stringifyResult(...))` behind those same spans, so the two forms cannot drift: the `Result` variant is the single engine path, and the `Effect` variant adds only the span. The `TomlFromString` codec's encode direction routes through `stringifyResult` for the same reason.

  The defect firewall is unchanged and now pinned on both paths. The engine's raw carriers (`RawTomlError`, `GuardExceeded`) still materialize into `TomlParseError` / `TomlStringifyError` — including a `NestingDepthExceeded` diagnostic for a depth bomb — while any other throw is a genuine defect and still escapes: as a `Die` through the `Effect` forms, and as a real synchronous throw to a `Result` caller, which is the correct shape for a defect at a synchronous boundary.

  Parity is asserted directly rather than assumed. Every representative document, error case and depth bomb is checked in both directions, so a future edit that re-derives the engine on one side fails in this package's own suite rather than in a consumer. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.2.0

### Breaking Changes

- ### `TrailingCommaInInlineTable` and `NewlineInInlineTable` error codes removed
  Both codes left `TomlParseErrorCode` and the aggregate `TomlErrorCode`. The
  constructs they rejected — a trailing comma before `}` and a newline inside&#10;`{ ... }` — are legal in TOML 1.1.0, so nothing produces either code any
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

### Features

- ### TOML 1.1.0 parsing, in place
  `Toml.parse` accepts the full TOML 1.1.0 grammar (the spec released
  2025-12-24) unconditionally. There is no spec-version option and no opt-in:
  1\.0 documents are a subset of what the parser already took, so existing input
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
  returns a `TomlBoundCodec` — the composed `schema` plus `decode` and `encode`&#10;derived from it — so call sites need no generic `Schema` machinery:
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
  Both directions fail with `Schema.SchemaError`, exactly as&#10;`Schema.decodeEffect` / `Schema.encodeEffect` over `Toml.schema(target)`&#10;would, and the target's decoding and encoding service requirements flow
  through. `bind` is schema-producing — each call composes a fresh schema and
  derives both directions from it — so bind the result to a `const` and reuse
  it; that single binding is the point. [#122][#122]

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

- Zero-dependency TOML 1.0.0 parsing, editing and formatting expressed as Effect schemas and pure functions. The engine is written from scratch against the TOML 1.0.0 spec — the only format package in the repo that vendors no upstream code — and parses into a lossless linear CST whose expression spans tile the source byte-exact, so `TomlDocument.parse(text).stringify()` reproduces the original text exactly for any valid document. `effect` is the only runtime dependency.
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
  Integers past ±(2^53 − 1) decode to `bigint` instead of silently losing precision, and TOML's four date-time types decode to calendar-validated `Schema.Class` value objects — `TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime` — instead of a `Date` that cannot represent a local time. TOML has no null, so `Toml.stringify` on a value containing `null` fails with a structured `UnsupportedValue` diagnostic naming the offending path rather than dropping the key. Every fallible entry point carries a typed error built from `TomlDiagnostic`, with nesting-depth guards so hostile input fails through that channel rather than as a stack overflow. `TomlVisitor` walks a document as a `Stream` of visitor events. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
