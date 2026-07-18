# Schema — v3 → v4

Verified against `effect@4.0.0-beta.94+`. Idiomatic form → see `effect-v4-schema`.

**`Schema.Schema` takes ONE type argument in v4.** The two-sided form is
`Schema.Codec`:

~~~ts
// v3                              // v4
Schema.Schema<A, I>                Schema.Codec<A, I>
                                   // interface Schema<out T>
                                   // interface Codec<out T, out E = T, RD = never, RE = never> extends Schema<T>
~~~

`Codec`'s never-defaulted `RD` / `RE` requirement channels are load-bearing:
they are what keeps `decodeUnknownEffect`'s `R` empty. Annotate a schema
parameter as `Schema.Codec<A, I>` when you need both sides; `Schema.Schema<A>`
when you only need the decoded type.

## Straight renames

| v3 | v4 |
| --- | --- |
| `asSchema(s)` | `revealCodec(s)` |
| `encodedSchema(s)` | `toEncoded(s)` — the v3 name is **gone**, not renamed in place |
| `typeSchema(s)` | `toType(s)` |
| `compose(b)` | `decodeTo(b)` |
| `annotations(ann)` | `annotate(ann)` |
| `decodingFallback` annotation | `catchDecoding(...)` |
| `parseJson()` | `UnknownFromJsonString` (a value/schema, not a fn) |
| `parseJson(schema)` | `fromJsonString(schema)` |
| `pattern(regex)` | `check(isPattern(regex))` |
| `nonEmptyString` | `isNonEmpty` |
| `BigIntFromSelf` | `BigInt` |
| `SymbolFromSelf` | `Symbol` |
| `URLFromSelf` | `URL` |
| `RedactedFromSelf` | `Redacted` (input already `Redacted`) |
| `Redacted` | `RedactedFromValue` (decodes raw → wraps) |
| `EitherFromSelf` | `Result` |
| `TaggedError` / `Data.TaggedError` | `TaggedErrorClass` (schema-backed, yieldable, serializable, `instanceof Error`) |
| `decodeUnknown` | `decodeUnknownEffect` |
| `decode` | `decodeEffect` |
| `decodeUnknownEither` | `decodeUnknownResult` (`Result` is v4's `Either`) or `decodeUnknownExit` |
| `decodeEither` | `decodeResult` or `decodeExit` |
| `encodeUnknown` | `encodeUnknownEffect` |
| `encode` | `encodeEffect` |
| `encodeUnknownEither` | `encodeUnknownResult` or `encodeUnknownExit` |
| `encodeEither` | `encodeResult` or `encodeExit` |
| `equivalence` | `toEquivalence` |
| `arbitrary` | `toArbitrary` |
| `pretty` | `toFormatter` |
| `standardSchemaV1` | `toStandardSchemaV1` |

**The decode/encode rows are NOT a family sweep.** Only the Effect-returning
base names (`decode`/`decodeUnknown`/`encode`/`encodeUnknown` → `*Effect`) and
the `*Either` variants (→ `*Result` / `*Exit`) are forced renames. The
`*Sync` / `*Option` / `*Promise` variants **survive unchanged**, typed and
`Unknown` flavors both — `decodeSync`, `decodeUnknownSync`, `encodeSync`,
`encodeUnknownSync`, and friends (verified beta.98, `Schema.d.ts:1377–1738`).
Do not "migrate" `encodeSync` to `encodeUnknownSync`: both exist, and they
differ by input type — `encodeSync` takes the typed `S["Type"]`,
`encodeUnknownSync` takes `unknown`. Prefer `encodeSync` (and `decodeSync`)
when the input is already a typed value; reach for the `*Unknown*` form only at
a genuinely untyped boundary.

One trap inside the renamed set: `Schema.decode` and `Schema.encode` still
**exist** in v4 — as transformation combinators taking a `SchemaGetter` pair
(`St.pipe(Schema.decode({ decode, encode }))`), not parsers. Reaching for the
v3 parser meaning does not get `undefined`; it gets a different function.

`*FromSelf` suffix dropped (the un-suffixed name is now the self schema):
`DateFromSelf`→`Date`, `DurationFromSelf`→`Duration`, `ChunkFromSelf`→`Chunk`,
`ReadonlyMapFromSelf`→`ReadonlyMap`, `ReadonlySetFromSelf`→`ReadonlySet`,
`HashMapFromSelf`→`HashMap`, `HashSetFromSelf`→`HashSet`,
`BigDecimalFromSelf`→`BigDecimal`, `CauseFromSelf`→`Cause`,
`ExitFromSelf`→`Exit`, `OptionFromSelf`→`Option`, `RegExpFromSelf`→`RegExp`.

## Numeric schemas — the plausible name that isn't real

| you want | v4 |
| --- | --- |
| an integer | `Schema.Int` **exists** (probed: `typeof` is `object`) |
| a non-negative integer | `Schema.NonNegativeInt` **does NOT exist** (`typeof` is `undefined`) — compose `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` |

`NonNegativeInt` reads like it must be there because `Int` is. It is not. The
removed `positive` / `negative` / `nonNegative` filters (below) are the reason:
there is no pre-composed non-negative anything.

## Filter renames — all now `is*`, applied via `.check(...)`

| v3 | v4 |
| --- | --- |
| `greaterThan` | `isGreaterThan` |
| `greaterThanOrEqualTo` | `isGreaterThanOrEqualTo` |
| `lessThan` | `isLessThan` |
| `lessThanOrEqualTo` | `isLessThanOrEqualTo` |
| `between` | `isBetween` |
| `int` | `isInt` |
| `multipleOf` | `isMultipleOf` |
| `finite` | `isFinite` |
| `minLength` | `isMinLength` |
| `maxLength` | `isMaxLength` |
| `length` | `isLengthBetween` |
| `positive` / `negative` / `nonNegative` / `nonPositive` | **Removed** (compose `isGreaterThan(0)` etc.) |

## Variadic → array / restructure

| v3 | v4 |
| --- | --- |
| `Literal(null)` | `Null` |
| `Literal("a", "b")` (variadic) | `Literals(["a", "b"])`; single `Literal("a")` stays single-arg |
| `pickLiteral("a", "b")` | `Literals([...]).pick(["a", "b"])` |
| `Union(A, B)` (variadic) | `Union([A, B])` (array) |
| `Tuple(A, B)` | `Tuple([A, B])` |
| `TemplateLiteral(A, B)` | `TemplateLiteral([A, B])` |
| `TemplateLiteralParser(A, B)` | `TemplateLiteralParser(schema.parts)` |
| `Record({ key, value })` | `Record(key, value)` (positional) |
| `filter(predicate)` | `check(makeFilter(predicate))` |
| `filter(refinement)` | `refine(refinement)` |
| `UUID` | `String.check(isUUID())` |
| `ULID` | `String.check(isULID())` |
| `pick("a")` | `mapFields(Struct.pick(["a"]))` |
| `omit("a")` | `mapFields(Struct.omit(["a"]))` |
| `partial` | `mapFields(Struct.map(Schema.optional))` |
| `partialWith({ exact: true })` | `mapFields(Struct.map(Schema.optionalKey))` |
| `required(schema)` | `mapFields(Struct.map(Schema.requiredKey))` |
| `extend(structB)` | `mapFields(Struct.assign(fieldsB))` or `fieldsAssign(fieldsB)` |
| `transform(from, to, { decode, encode })` | `from.pipe(decodeTo(to, SchemaTransformation.transform({ decode, encode })))` |
| `transformOrFail(from, to, ...)` | `from.pipe(decodeTo(to, { decode: SchemaGetter.transformOrFail(...), encode: ... }))` |
| `transformLiteral(from, to)` | `Literal(from).transform(to)` |
| `transformLiterals(...)` | `Literals([...]).transform([...])` |
| `attachPropertySignature("k", "v")` | `mapFields(f => ({ ...f, k: tagDefaultOmit("v") }))` |

> `mapFields` is an **instance method** on struct schemas (`St.mapFields(...)`),
> NOT a `Schema.mapFields` static.
>
> Top-level `Schema.transform` / `Schema.transformOrFail` **do not exist as
> callables** in beta.94 (`typeof` is `undefined`; calling throws
> `Schema.transform is not a function`) — observed in the first boundary port.
> The v4 form is always `Source.pipe(Schema.decodeTo(Target,
> SchemaTransformation.transform({ decode, encode })))` (or `transformOrFail`);
> `transform` lives on `SchemaTransformation`, not `Schema`.
>
> Open struct: `Schema.Struct(fields, indexSignature)` (the 2-arg form) **runs at
> runtime but is REJECTED by tsgo** (it wants `Schema.StructWithRest` — which does
> exist). Don't reach for the 2-arg struct; model an open remainder with
> `Schema.Record(key, value)` or a `decodeTo` key-partition instead (first
> boundary port).

Removed (no v4 equivalent): `validate*` (use `decode*` + `toType`), `keyof`,
`NonEmptyArrayEnsure`, `withDefaults`, `Data(schema)` (v4 `Equal.equals` is
deep-structural by default, so `Schema.Data` is unnecessary).

## Manual / case-by-case

- `optionalWith(schema, opts)` — decision tree by option combo: `{ exact: true }`
  → `optionalKey`; `{ default }` → `withDecodingDefaultType`;
  `{ exact, default }` → `withDecodingDefaultTypeKey`; `{ nullable }` → wrap in
  `NullOr` + `decodeTo` + `Option.filter(Predicate.isNotNull)`
  (+ `Option.orElseSome` when `default`).
  **`{ default }` needs a second half:** the `withDecodingDefault*` family covers
  decode only, but v3 `optionalWith(S, { default })` also defaulted at class
  construction — for parity compose `Schema.withConstructorDefault(...)` on the
  same field, or `X.make({})` throws `Missing key` where v3 filled the default
  (probed beta.94: decode-only → `make({})` throws; composed pair → `{"deps":{}}`.
  Worked example: `@effected/lockfiles` `ResolvedPackage.dependencies`).
- `optionalToOptional` / `optionalToRequired` / `requiredToOptional` →
  `decodeTo` + `SchemaGetter.transformOptional`.
- `filterEffect` →
  `decode({ decode: SchemaGetter.checkEffect(...), encode: SchemaGetter.passthrough() })`.
- `fromKey` / `rename({ a: "c" })` → `encodeKeys({ a: "c" })` (experimental).
- `asserts(schema)(input)` → `asserts(schema, input)` (single call, no longer curried).
- `format(schema)` → `SchemaRepresentation.fromAST(S.ast)` → `toMultiDocument` → `toCodeDocument`.
- `ParseResult.ArrayFormatter.formatError(err)` →
  `SchemaIssue.makeFormatterStandardSchemaV1()(err.cause).issues`.
- `Capitalize` / `Lowercase` / etc. →
  `String.pipe(decodeTo(String.check(isCapitalized()), SchemaTransformation.capitalize()))`.
- `NonEmptyTrimmedString` → `Trimmed.check(isNonEmpty())`.
- `split(sep)` → hand-rolled `String.pipe(decodeTo(Array(String), SchemaTransformation.transform({...})))`.

## Module-name changes for imports — the v3 `ParseResult` module split apart

| v3 import | v4 import |
| --- | --- |
| `ParseResult` (failure ctors: `InvalidValue`, `MissingKey`, `Composite`, `isIssue`) | `SchemaIssue` |
| `ParseResult` (the thrown parse error) | `SchemaError` |
| `ParseResult` (getters: `transformOrFail`, `transformOptional`, `checkEffect`, `passthrough`, `String`) | `SchemaGetter` |
| `ParseResult` (transformations: `transform`, `transformOrFail`, `capitalize`) | `SchemaTransformation` |
| `ParseResult` (`format` machinery) | `SchemaRepresentation` |
| `Either` | `Result` |

## Derived tooling

Exact names: `toJsonSchemaDocument` (**not** `toJsonSchema`), `toEquivalence`,
`toFormatter`, `toStandardSchemaV1`.

**`toJsonSchemaDocument(S)` returns `{ dialect, schema, definitions }`** — probed
on beta.94. It does **not** hand you a bare JSON Schema: there is no top-level
`$defs` and no top-level `properties`. The schema you want is under `.schema`,
and the shared subschemas are under `.definitions` (not `$defs`). Code that
reaches straight for `doc.properties` or `doc.$defs` reads `undefined` and, if it
only ever feeds a permissive consumer, does so silently.
