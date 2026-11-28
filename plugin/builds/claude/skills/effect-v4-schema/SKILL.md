---
name: effect-v4-schema
description: >-
  Use when designing, reading, reviewing, or debugging any Effect v4 Schema — the Class-vs-Struct decision, fields
  and optionality, checks/refine/makeFilter, tagged unions, transformations and codecs (decodeTo, the FromString
  static), make-vs-new construction, brand/Opaque scalars, custom Equal/Hash, and derived tooling
  (Arbitrary.schema, toJsonSchemaDocument). Also covers primitives, records, recursive schemas, custom declare
  types, serialization (JSON/XML/FormData), and error formatting.
when_to_use: >-
  validate input, decode unknown JSON into a type, parse a JSON string, JSON Schema from a type, data model, DTO,
  zod-style validation, optional field, discriminated union
---

# Effect v4 Schema

The single skill for Effect v4 `Schema`. (For which of the `Schema*` satellite
modules is consumer-facing vs machinery, see `effect-v4-module-index`.) It
carries three layers:

1. **The house rules** — the [Do this, not this](#do-this-not-this) table and
   the footguns below, our opinionated defaults distilled from the `@effected`
   packages.
2. **The house references** — the worked examples and the reasoning behind each
   rule, one topic per file, listed under
   [Additional resources](#additional-resources).
3. **Effect's own canonical Schema guide** (`Effect-TS/effect`,
   `packages/effect/SCHEMA.md`), split by topic into the numbered references,
   for the exhaustive detail on any construct.

Load one reference at a time — each is a standalone topic, and some run past a
thousand lines.

**Look it up first.** Before you write a schema for a format someone else
defines (a version, a version range, an SPDX licence, `package.json`,
`tsconfig.json`, a lockfile, a GitHub event, a JSON Schema document), grep the
kit: `grep -ri "<format> schema" "${CLAUDE_PLUGIN_ROOT}/skills/effected-packages/references/constructs/"`.
Core already ships `SemVer`, `SemVerRange`, `ByteSize`, `Duration`,
`DateTime` and network-address schemas
([effect-v4-module-index](../effect-v4-module-index/SKILL.md)). A hand-written
schema for one of these drifts from the format and from every kit API that
takes the kit's class.

## Do this, not this

Each row is a hard house default; the worked code is in
[house-style.md](./references/house-style.md) unless the row names another
reference.

Naming trap: `Schema.TaggedErrorClass` and `Schema.ErrorClass` are both
`undefined` on the `Schema` namespace — the current names are
`Schema.TaggedError` (`Schema.ts:17758`) and `Schema.Error` (`:17697`), with the same
curried call shape. Code written against the older names fails with
"TaggedErrorClass is not a function".

| Do | Not |
| --- | --- |
| `Schema.Class` / `TaggedClass` / `TaggedError` for any reusable model, union member, or error | a bare `Schema.Struct` for a domain type — `Struct` is for throwaway inline shapes |
| `X.make({...})` as the default constructor — EXCEPT `TaggedError`, where failing with the yieldable `yield* new SomeError({...})` is the house idiom | `new X({...})` for models outside a measured hot path (both validate identically) |
| copy-with-patch by spreading the instance into the factory: `X.make({ ...x, field: next })` — own fields carry over, an absent `optionalKey` stays absent, defaults keep their value, checks re-run, and `#` private fields and class-body own props are rebuilt by the subclass | enumerating the fields by hand in a transform meant to preserve them (`X.make({ a: x.a, b: x.b, ... })`) — it type-checks today and silently drops any field added later; a hand-written list is right only when the transform is *meant* to choose fields |
| `{ disableChecks: true }` only to accept *trusted* data that would fail a `.check(...)` | it as a **speed** switch — it gates only the check phase ("skip filters and checks while still parsing types and structure", `Schema.ts:137`): a type error still throws, the structural re-parse still runs, and a depth-20 recursive build is sub-millisecond either way |
| treat a nested `Schema.Class` field the same whether it is **foreign** or **self-recursive** — both accept a plain literal, deep-validate it, promote it to an instance, and pass a real instance through **by reference** | assume the two split, or that a foreign field is re-constructed so `Outer.make({ inner: x }).inner !== x`; a **prototype-forged** instance is accepted unexamined either way ([classes-and-construction.md](./references/classes-and-construction.md)) |
| dodge the factory's reserved statics — every `Schema.Class`/`TaggedClass`/`TaggedError` base declares `identifier`, `fields`, `ast`, `pipe`, `rebuild`, `make`, `makeOption`, `makeEffect`, `annotate`, `annotateKey`, `check`, `extend`, `mapFields` (`makeClass`, `Schema.ts:17329`) | a domain static reusing one of those names — an incompatible signature is TS2417 (*static side incorrectly extends base*); rename it (`check` → `compare`) |
| name a validating string constructor `parse` / `parseResult` — **`make` is reserved and cannot be overloaded** ([classes-and-construction.md](./references/classes-and-construction.md)) | `static make(raw: string)` on a `Schema.Class` — TS2417, every time |
| conditional-spread an absent optional field | an explicit `undefined` for a `Schema.optionalKey` — a *present* `undefined` throws |
| cross-field validation on a class: pass a **checked Struct** to the factory — `Schema.Class<X>("X")(Schema.Struct(fields).check(...))`; `check` returns `this["Rebuild"]` (`Schema.ts:213`), so the factory accepts it and the check sees the whole record | per-field checks that need a sibling's value (a field check sees only its field), or cross-field invariants in a `parse` wrapper the direct `make` path never runs |
| `Schema.optionalKey` for object fields — `field?: T`, the exact-optional contract `exactOptionalPropertyTypes` wants ([exact-optional-fields.md](./references/exact-optional-fields.md)) | `Schema.optional` unless the *value* must carry `undefined` — "Equivalent to `optionalKey(UndefinedOr(S))`" (`Schema.ts:2449`), so it **admits `{ field: undefined }`** |
| `.check(is*)` to constrain, `refine` to narrow, `check(makeFilter(...))` for cross-field | `positive`/`negative`, or the `filter`/`greaterThan` spellings — none of them exist |
| tagged unions of `TaggedClass` members (`_tag` branching) | untagged unions for domain variants |
| `Schema.Literals(["a", "b", "c"])` for any multi-literal union | the variadic `Schema.Literal("a", "b", "c")` — `Literal` takes ONE argument; tsgo rejects it (TS2554), but the **runtime keeps only the first literal**, so a suite run before typecheck green-lights a schema that rejects `"b"` and `"c"` |
| `Source.pipe(decodeTo(Target, SchemaTransformation.transform({...})))` | a top-level `Schema.transform` / `transformEffect` — both are `undefined` on the `Schema` namespace |
| pin `transformEffect`'s type params when a union codec's members carry instance methods — `SchemaTransformation.transformEffect<(typeof Classified)["Encoded"], string>({...})` | relying on inference after adding a method to a `TaggedClass` union member — `decodeTo` pins `T` to the union's **Encoded** side, which no longer satisfies the method-bearing type, and the existing codec breaks at its declaration |
| return an **`Effect`** from both `transformEffect` callbacks, failing with `SchemaIssue.InvalidValue({ message }, value)` ([codecs-and-wire-fidelity.md](./references/codecs-and-wire-fidelity.md)) | a `Result` or a bare value — the signature demands `Effect<T, SchemaIssue.Issue, R>` (`SchemaTransformation.ts:390`) |
| a `FromString` `Schema.Codec<Self, string>` static (string = the encoded form of the same schema) | a second parser divorced from the schema |
| `cause: Schema.Defect()` on an error class | `cause: Schema.Defect` — the uncalled form throws at construction (`Schema.ts:9367` is a *function*; `Schema.ErrorInstance` at `:9295` is the same trap; `Schema.Error` (`:17697`) is the error-**class factory**, not an instance schema — the full call-not-value list is in **`effect-v4-idioms`**) |
| `Schema.decodeUnknownEffect` / `encodeUnknownEffect` in Effect flows | `*Sync` outside a genuine sync boundary |
| `Schema.fromJsonString(S)` (`Schema.ts:9832`) when the encoded form is a JSON **string** — one codec that parses-then-decodes (`reviver` / `replacer` / `space` options); for a config or action input, `Config.schema(Schema.fromJsonString(S), "NAME")` (`Config.ts:870`), whose `withDefault` behaviour is in **`effect-v4-idioms`** | `JSON.parse` / `JSON.stringify` around `decodeUnknown*` / `encodeUnknown*` — a second parser, with a throwing host call in the seam that no downstream `Effect.catch` sees |
| `Schema.DurationFromMillis` / `Schema.DateTimeUtcFromString` (composed with `Schema.fromJsonString` for byte stores) when the value must **serialize** | `Schema.Duration` / `Schema.DateTimeUtc` in a persisted or wire schema — `declare` schemas with **no JSON encoding** (`Schema.ts:13805,11646`): they round-trip in memory and fail at the serialization boundary |
| annotate recursive `Schema.suspend` refs `Schema.Codec<T>` (services default `never`) | `Schema.Schema<T>` as the suspend annotation — it leaves `DecodingServices` `unknown`, so every decode entrypoint rejects the schema (`unknown is not assignable to never`), and a schema nobody decodes directly hides it until a consumer tries |
| derive variants via `mapFields(Struct.pick/omit/map(...))` | duplicate a schema to re-encode the same data |
| re-apply a struct-level `.check(...)` after `mapFields` or `Schema.fieldsAssign` — `S.mapFields(f).check(...)`, or `mapFields(f, { unsafePreserveChecks: true })` once the check still holds | expect a derived struct to keep the original's checks — `mapFields` keeps `this.ast.checks` only under `unsafePreserveChecks` (`Schema.ts:3566`), and `fieldsAssign` is `struct.mapFields(Struct.assign(fields))` with no option (`Schema.ts:3649`); per-field checks travel with their fields |
| attach brand statics with `Object.assign`; export the type as `string & Brand.Brand<"N">` | try to merge a `namespace` into the brand `const` (impossible) |
| override BOTH `[Equal.symbol]` AND `[Hash.symbol]` when equality ignores fields | override `[Equal.symbol]` alone — the hash fast-path silently defeats it |
| `Schema.isSchema(x)` (`Schema.ts:2349`) to recognise a schema at runtime — every schema is a **function** ([schema-identity-at-runtime.md](./references/schema-identity-at-runtime.md)) | `typeof x === "object" && x !== null` as a schema guard — it rejects **every** schema |
| `S extends Schema.ConstraintDecoder<unknown>` as the bound of a helper that wraps `decodeUnknownResult` / `decodeUnknownExit` / `decodeUnknownOption` — core's own decode entry points use it (`Schema.ts:1737,1605,1673`) | `S extends Schema.Top` — `Top` erases `DecodingServices` to `unknown`, so the call into `decodeUnknownResult` fails to type-check; `Top` is for utilities that never decode (its docstring at `Schema.ts:770` sends decode-only APIs to `ConstraintDecoder`) |
| `Schema.toJsonSchemaDocument(S)` — it returns `{ dialect, schema, definitions }` | `Schema.toJsonSchema(S)` — that export does not exist; and no `$defs` / `properties` at the top |
| a single-return **ternary chain** in an error's `message` getter | an exhaustive `switch` with no terminal return — tsgo accepts it, Biome's `useGetterReturn` rejects it |
| `Schema.Class` + `Schema.tag("literal")` on an explicitly-named field when the discriminator belongs to a FOREIGN contract | `Schema.TaggedClass` for a foreign discriminator — it hardwires the key `_tag` |

## Footguns

- **`Schema.Struct` drops unknown keys silently on decode**, so a typo'd key and
  an absent one look the same. Decode anything a human typed with
  `Schema.decodeUnknownEffect(S)(input, { onExcessProperty: "error", errors: "all" })`,
  and leave a machine payload you do not own on the default `"ignore"`. **A
  rest switches excess checking off for its whole struct.** Before you decode
  user-authored config, load [excess-keys.md](./references/excess-keys.md):
  there is no `"preserve"`, and every rest spelling that looks stricter is not.
- **`Schema.optional` compiles clean and admits `{ field: undefined }`
  forever.** Before you choose between `optional` and `optionalKey`, load
  [exact-optional-fields.md](./references/exact-optional-fields.md).
- **`make` is reserved on every class factory**, so string input goes through a
  `parse` / `parseResult` pair. Before you add statics, a nested class field, a
  foreign discriminator or a constructor default, load
  [classes-and-construction.md](./references/classes-and-construction.md):
  `withConstructorDefault` takes an **Effect**, and a thunk dies at
  construction with `Fiber.runLoop: Not a valid effect`.
- **Class instances compare deep and structural, but are not frozen**: a
  mutated instance keeps stale derived state while still satisfying its type,
  and a present `{}` and an absent `optionalKey` compare unequal. Rebuild with
  `make`; never assign a field. Detail in
  [classes-and-construction.md](./references/classes-and-construction.md).
- **A union of two members that decode to the same Type cannot round-trip the
  input encoding**, and `Schema.decodeTo(C, …)` with a `Schema.Class` target
  hands back a *different* instance, defeating any `WeakMap` keyed on it. Before
  you write a codec that must preserve its wire form, load
  [codecs-and-wire-fidelity.md](./references/codecs-and-wire-fidelity.md).
- **A `Schema.check` narrowing is erased from the published `.d.ts`**, so a
  re-forked checked schema and a strictened check are both type-invisible.
  Before you share a checked schema across modules, or recognise a schema at
  runtime, load
  [schema-identity-at-runtime.md](./references/schema-identity-at-runtime.md).
- **The Standard Schema formatter gives no code per failure.** Before you build
  `{ code, path, message }` diagnostics from a `SchemaIssue`, load
  [issue-diagnostics.md](./references/issue-diagnostics.md) for the walker.

## Verify against the installed source, not the references

The numbered references track **upstream `Effect-TS/effect` main**, which may
run AHEAD of your installed `effect`. Treat them as authoritative on *shape and
intent*, not on exact export names. Before relying on any specific API, probe
it:

```bash
node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.TheApiYouWant)"
```

If it prints `undefined`, the name moved or has not landed yet — check
`node_modules/effect/dist/Schema.d.ts`, or climb the `effect-v4-source-lookup`
ladder. The rules above already fold in the gotchas the upstream prose does not
flag. The skew cuts both ways: `09-classes-and-opaque-types` still documents
`Schema.asClass`, which is **`undefined`** — subclass the schema value directly
(`class MyString extends Schema.String {}`).

## Additional resources

House references:

- [house-style.md](./references/house-style.md) — the worked code behind every table row: Class vs Struct, `make` vs `new`, `disableChecks`, linear recursive construction, fields and decoding defaults, checks/refine/makeFilter, unions, transformations and `FromString` statics, derivation, brands, derived tooling names, custom equality, Arbitrary-safe constraints and the import graph. Load when: applying a table row and you need its worked example or the reason behind it.
- [excess-keys.md](./references/excess-keys.md) — `onExcessProperty`, `errors: "all"`, and the four rest spellings under `"error"`. Load when: decoding config a person wrote, or a typo'd key "passed validation".
- [exact-optional-fields.md](./references/exact-optional-fields.md) — `optional` versus `optionalKey` under `exactOptionalPropertyTypes`, the source, the probe and the JSON Schema difference. Load when: declaring an optional field, or a `{ field: undefined }` compiled when it should not.
- [classes-and-construction.md](./references/classes-and-construction.md) — the `parse`/`parseResult` pair, nested class fields (identity, forged instances, the type-level axis, linear cost), deep equality and unfrozen instances, `Schema.Record` equality, the `message` getter, `Schema.tag` for a foreign discriminator, the two factory signatures and `withConstructorDefault`. Load when: adding a static, a nested or recursive class field, a foreign `type` discriminator, a constructor default or an error `message` getter.
- [codecs-and-wire-fidelity.md](./references/codecs-and-wire-fidelity.md) — `transformEffect`'s signature and failure shape, `SchemaIssue.InvalidValue`'s constructor, encode-lossy unions, and `Schema.instanceOf` as a `decodeTo` target with its riders. Load when: writing a fallible transformation, a union of an object and its string shorthand, or a codec that must remember its input encoding.
- [schema-identity-at-runtime.md](./references/schema-identity-at-runtime.md) — erased check narrowings, the runtime identity assertion that guards a shared checked schema, and schemas as functions. Load when: two modules must share one checked schema, a check gets stricter, or code must tell a schema from a plain object.
- [issue-diagnostics.md](./references/issue-diagnostics.md) — the `Issue` union and a walker that yields `{ code, path, message }`, with the probed output. Load when: turning a decode failure into coded diagnostics.

Effect's canonical guide, one topic per file; each carries a provenance banner:

- [01-overview](./references/01-overview.md) — the design philosophy: codecs, the Type/Encoded split, the `~`-prefixed internal type members. Load when: orienting on how Schema thinks.
- [02-elementary-schemas](./references/02-elementary-schemas.md) — primitives, literals, strings and string formats, numbers/integers/bigints, dates, template literals. Load when: picking a scalar schema.
- [03-composite-schemas](./references/03-composite-schemas.md) — structs, tuples, arrays, records, unions, recursive schemas; the biggest section. Load when: modeling an object, a collection, a union or a recursive shape.
- [04-custom-types](./references/04-custom-types.md) — `Schema.declare` and `declareConstructor`. Load when: Schema has no schema for the type you hold.
- [05-validation](./references/05-validation.md) — filters, checks/refinements/branding, structural and effectful filters, multiple issues, aborting, filter groups. Load when: writing a check beyond the table's spellings.
- [06-constructors](./references/06-constructors.md) — `make` in composed/branded/refined schemas, default values including effectful ones. Load when: a constructor default or a branded `make` misbehaves.
- [07-transformations](./references/07-transformations.md) — `decodeTo`/`encodeTo`, composing, passthrough helpers, optional-key management, omit-on-encode. Load when: writing any transformation.
- [08-flipping-schemas](./references/08-flipping-schemas.md) — `Schema.flip` and what it does to constructors. Load when: you need the encoded side as the Type.
- [09-classes-and-opaque-types](./references/09-classes-and-opaque-types.md) — opaque structs, schema-as-a-class, the `Schema.Class` family. Load when: designing a class's methods, statics or extension.
- [10-serialization](./references/10-serialization.md) — JSON, string encoding, FormData, URLSearchParams, canonical codecs, the XML encoder. Load when: a value must cross a wire or a store.
- [11-generation-and-tooling](./references/11-generation-and-tooling.md) — JSON Schema derivation, the native `Arbitrary` generator and its traps, Equivalence, Optic, JSON patches via Differ. Load when: deriving JSON Schema, an arbitrary, an equivalence or a patch.
- [12-schema-representation](./references/12-schema-representation.md) — the introspectable representation, its limits, JSON round-tripping, rebuilding schemas, code generation. Load when: serializing or generating schemas themselves.
- [13-error-handling-and-formatting](./references/13-error-handling-and-formatting.md) — `SchemaError`/`SchemaIssue`, formatters, Standard Schema v1 output. Load when: formatting a decode failure for a person.
- [14-middlewares](./references/14-middlewares.md) — decode/encode middlewares and fallbacks. Load when: a decode needs a fallback value or a wrapper.
- [15-advanced-topics](./references/15-advanced-topics.md) — the internal model, type hierarchy, typed annotations, generics and separate requirement parameters. Load when: writing a generic helper over schemas.
- [16-integrations](./references/16-integrations.md) — TanStack Form, Elysia. Load when: wiring Schema into one of those frameworks.

## Related skills

- **`effect-v4-idioms`** — core Effect patterns, and the **call-not-value** list
  (`Schema.Defect()`, `Schema.ErrorInstance()`, `TestClock.layer()`) — names that
  exist, type-check uncalled, and fail somewhere else.
- **`effect-v4-source-lookup`** — when a Schema name doesn't resolve:
  the evidence ladder that settles existence, signature and semantics.
- **`effect-api-extractor-bases`** — the anonymous-base / `ae-forgotten-export`
  discipline for `Schema.Class` and `Context.Service`.
- **`effect-v4-services-layers`** — the sibling for `Context.Service` and Layers.
- **`effect-v4-planning`** — design a schema/service before writing it.
