<!--
Vendored from the Effect canonical Schema guide (Effect-TS/effect, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect v4 beta in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect/blob/main/packages/effect/SCHEMA.md

API surface audited against effect@4.0.0-beta.107: `toJsonSchemaDocument`, `JsonSchema.toDocumentDraft07`,
`toEquivalence`, `toIso`/`Optic` and `toDifferJsonPatch` all exist as described, and every code block
typechecks. FALSIFIED and corrected inline: `Schema.toJsonSchema` in prose (the entry point is
`toJsonSchemaDocument`) and `new SchemaIssue.InvalidType(ast, Option.some(input))`. PROBED and restored:
the Iso and Differ conversion failures do throw a bare `Error("Schema validation failed")` carrying a
`SchemaIssue.Issue` in `cause`.

rc.115 (2026-09-12): the "Generating an Arbitrary from a Schema" section was REWRITTEN — the fast-check
bridge (`Schema.toArbitrary`, `effect/testing/FastCheck`, the `toArbitrary`/`arbitrary` annotations) was
removed in rc.113 (Effect-TS/effect#7254) for the native `effect/unstable/arbitrary` module; the
section's claims are settled against `unstable/arbitrary/Arbitrary.ts`, `ARBITRARY.md`,
`ARBITRARY-MIGRATION.md` and the probes named inline. Also at rc.113 `ToJsonSchemaOptions.additionalProperties`
became `onExcessProperty: "ignore" | "error"` with the DEFAULT NOW OPEN — every object blob below shows
`"additionalProperties": true`, which is what a bare `toJsonSchemaDocument` emits at rc.115 (probed;
`{ onExcessProperty: "error" }` gives `false`, and the retired `additionalProperties: false` option is
silently ignored at runtime — only the type-checker catches the stale spelling). The JSON Schema output blobs were otherwise NOT re-probed.
-->

# Schema Generation and Tooling

Schema can derive JSON Schemas, test data generators (Arbitraries), equivalence checks, optics, and more from a single schema definition.

### Generating a JSON Schema from a Schema

#### Basic Conversion

By default, a schema produces a draft-2020-12 JSON Schema.

The result is a data structure including:

- the source of the JSON Schema (e.g. `draft-2020-12`, `draft-07`, etc...)
- the JSON Schema itself
- any definitions referenced by `$ref` (if any)

**Example** (Tuple to draft-2020-12 JSON Schema)

```ts
import { Schema } from "effect"

// Define a tuple: [string, number]
const schema = Schema.Tuple([Schema.String, Schema.Finite])

// Generate a draft-2020-12 JSON Schema
const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
Output:
{
  "source": "draft-2020-12",
  "schema": {
    "type": "array",
    "prefixItems": [
      {
        "type": "string"
      },
      {
        "type": "number"
      }
    ],
    "maxItems": 2,
    "minItems": 2
  },
  "definitions": {}
}
*/
```

To generate a draft-07 JSON Schema, use `JsonSchema.toDocumentDraft07` to convert the draft-2020-12 JSON Schema.

**Example** (Tuple to draft-7 JSON Schema)

```ts
import { JsonSchema, Schema } from "effect"

const schema = Schema.Tuple([Schema.String, Schema.Finite])

const doc2020_12 = Schema.toJsonSchemaDocument(schema)
const doc07 = JsonSchema.toDocumentDraft07(doc2020_12)

console.log(JSON.stringify(doc07, null, 2))
/*
Output:
{
  "source": "draft-07",
  "schema": {
    "type": "array",
    "maxItems": 2,
    "minItems": 2,
    "items": [
      {
        "type": "string"
      },
      {
        "type": "number"
      }
    ]
  },
  "definitions": {}
}
*/
```

#### Attaching Standard Metadata

Use `.annotate(...)` to attach standard JSON Schema annotations:

- `title`
- `description`
- `default`
- `examples`
- `readOnly`
- `writeOnly`

**Example** (Adding basic annotations)

```ts
import { Schema } from "effect"

const schema = Schema.NonEmptyString.annotate({
  title: "Username",
  description: "A non-empty user name string",
  default: "anonymous",
  examples: ["alice", "bob"]
})

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "string",
    "allOf": [
      {
        "minLength": 1,
        "title": "Username",
        "description": "A non-empty user name string",
        "default": "anonymous",
        "examples": [
          "alice",
          "bob"
        ]
      }
    ]
  },
  "definitions": {}
}
*/
```

#### Annotating the Encoded Side of a Transformation

When a schema includes a transformation (e.g. `Schema.Trim`), the generated JSON Schema corresponds to the encoded side. Calling `.annotate(...)` on a transformation annotates the decoded side, so the annotations won't appear in the JSON Schema output.

To annotate the encoded side, use `Schema.annotateEncoded`.

**Example** (Annotating the encoded side of `Trim`)

```ts
import { Schema } from "effect"

const schema = Schema.Trim.pipe(
  Schema.annotateEncoded({
    description: "my description",
    title: "my title"
  })
)

console.log(JSON.stringify(Schema.toJsonSchemaDocument(schema), null, 2))
/*
{
  "dialect": "draft-2020-12",
  "schema": {
    "type": "string",
    "title": "my title",
    "description": "my description"
  },
  "definitions": {}
}
*/
```

Alternatively, build a custom transformation using `Schema.decodeTo`:

```ts
import { Schema, SchemaTransformation } from "effect"

const schema = Schema.String.annotate({
  description: "my description",
  title: "my title"
}).pipe(Schema.decodeTo(Schema.Trimmed, SchemaTransformation.trim()))

console.log(JSON.stringify(Schema.toJsonSchemaDocument(schema), null, 2))
/*
{
  "dialect": "draft-2020-12",
  "schema": {
    "type": "string",
    "title": "my title",
    "description": "my description"
  },
  "definitions": {}
}
*/
```

#### Optional fields / elements

Optional fields are converted to optional fields or elements in the JSON Schema.

**Example**

```ts
import { Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.optionalKey(Schema.String)
})

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "object",
    "properties": {
      "a": {
        "type": "string"
      }
    },
    "additionalProperties": true
  },
  "definitions": {}
}
*/
```

Fields including `undefined` (such as those defined unsing `Schema.optional` or `Schema.UndefinedOr`) are converted to optional fields or elements in the JSON Schema with a union with the `null` type.

**Example**

```ts
import { Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.optional(Schema.String)
})

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "object",
    "properties": {
      "a": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "additionalProperties": true
  },
  "definitions": {}
}
*/
```

#### Defining a JSON-safe representation for custom types

This example shows how `Schema.toCodecJson` and `Schema.toJsonSchemaDocument` can describe the same JSON shape for a custom type. (There is no `Schema.toJsonSchema`; the JSON Schema entry point is `toJsonSchemaDocument`, as every example in this file uses.)

`Headers` is not JSON-friendly by default. `JSON.stringify(new Headers({ a: "b" }))` produces `{}` because the header data is not stored in enumerable properties. By adding a `toCodecJson` annotation, you define a JSON-safe representation and use it for both serialization and JSON Schema generation.

**Example** (Align a JSON serializer and JSON Schema for `Headers`)

```ts
import { Schema, SchemaGetter } from "effect"

const data = new Headers({ a: "b" })

// `Headers` does not serialize to JSON in a useful way by default.
console.log(JSON.stringify(data))
// {}

// Define a schema with a `toCodecJson` annotation.
// The JSON form will be: [ [name, value], ... ].
const MyHeaders = Schema.instanceOf(Headers, {
  toCodecJson: () =>
    Schema.link<Headers>()(
      // JSON-safe representation: array of [key, value] pairs
      Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
      {
        decode: SchemaGetter.transform((headers) => new Headers(headers.map(([key, value]) => [key, value]))),
        encode: SchemaGetter.transform((headers) => [...headers.entries()])
      }
    )
})

const schema = Schema.Struct({
  headers: MyHeaders
})

// Build a serializer that produces JSON-safe values using the `toCodecJson` annotation.
const serializer = Schema.toCodecJson(schema)

const json = Schema.encodeUnknownSync(serializer)({
  headers: data
})

// The JSON-encoded value:
console.log(json)
// { headers: [ [ 'a', 'b' ] ] }

// Generate a JSON Schema that matches the JSON-safe shape produced by the serializer.
const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document.schema, null, 2))
/*
{
  "type": "object",
  "properties": {
    "headers": {
      "type": "array",
      "items": {
        "type": "array",
        "prefixItems": [
          {
            "type": "string"
          },
          {
            "type": "string"
          }
        ],
        "maxItems": 2,
        "minItems": 2
      }
    }
  },
  "required": [
    "headers"
  ],
  "additionalProperties": true
}
*/

// Example (Decode a JSON-safe value using the same serializer)
// If a value matches the JSON Schema above, you can decode it with the serializer.
console.log(String(Schema.decodeUnknownExit(serializer)(json)))
// Success({"headers":Headers([["a","b"]])})
```

#### Validation Constraints

**Example**

```ts
import { Schema } from "effect"

const schema = Schema.String.check(Schema.isMinLength(1))

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "string",
    "allOf": [
      {
        "minLength": 1
      }
    ]
  },
  "definitions": {}
}
*/
```

**Example** (Multiple filters)

```ts
import { Schema } from "effect"

const schema = Schema.String.check(
  Schema.isMinLength(1, { description: "description1" }),
  Schema.isMaxLength(2, { description: "description2" })
)

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "string",
    "allOf": [
      {
        "minLength": 1,
        "description": "description1"
      },
      {
        "maxLength": 2,
        "description": "description2"
      }
    ]
  },
  "definitions": {}
}
*/
```

#### The fromJsonString combinator

With `fromJsonString`, the generated schema uses `contentSchema` to embed the JSON Schema of the decoded value.

**Example** (Embedding `contentSchema` for JSON string content)

```ts
import { Schema } from "effect"

// Original value is an object with a string field 'a'
const original = Schema.Struct({ a: Schema.String })

// fromJsonString: the outer value is a string,
// but its content must be valid JSON matching 'original'
const schema = Schema.fromJsonString(original)

const document = Schema.toJsonSchemaDocument(schema)

console.log(JSON.stringify(document, null, 2))
/*
{
  "source": "draft-2020-12",
  "schema": {
    "type": "string",
    "contentMediaType": "application/json",
    "contentSchema": {
      "type": "object",
      "properties": {
        "a": {
          "type": "string"
        }
      },
      "required": [
        "a"
      ],
      "additionalProperties": true
    }
  },
  "definitions": {}
}
*/
```

### Generating an Arbitrary from a Schema

Property-based generation is native to core since rc.113 (Effect-TS/effect#7254):
the module is **`effect/unstable/arbitrary`**, and it starts from a Schema.

```ts
import { Effect, Schema } from "effect"
import { Arbitrary } from "effect/unstable/arbitrary"

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Int.check(Schema.isBetween({ minimum: 18, maximum: 80 }))
})

const PersonArbitrary = Arbitrary.schema(Person) // Arbitrary<Person["Type"]>

const samples = await Effect.runPromise(
  Arbitrary.sampleEffect(PersonArbitrary, { count: 3, seed: 42 })
)
```

> **The fast-check bridge is gone — every one of these is `undefined` or
> `ERR_MODULE_NOT_FOUND` at rc.115** (probed; the control printed
> `resolved effect: 4.0.0-rc.115`): `effect/testing/FastCheck`, `FastCheck`
> from `effect/testing`, `Schema.toArbitrary`, `Schema.Arbitrary`, the
> `fastCheck: { numRuns }` option of `it.prop`/`it.effect.prop`, the legacy
> `toArbitrary` declaration annotation and the `arbitrary: { constraint,
> candidate }` filter annotation. The upstream migration guide is
> `packages/effect/ARBITRARY-MIGRATION.md` in the vendored tree; the module's
> own guide is `packages/effect/ARBITRARY.md`. fast-check is no longer a
> dependency of `effect` — a test that genuinely needs it installs it directly
> and keeps it out of `@effect/vitest`, which no longer accepts raw fast-check
> arbitraries.

The whole public surface is twelve names (`unstable/arbitrary/Arbitrary.ts`,
re-verified at rc.115):

| name | what it is |
| --- | --- |
| `Arbitrary.schema(S, { shrink? })` (`:346`) | derive a generator of `S["Type"]` — decoded values, so `NumberFromString` yields numbers. Derivation is eager and **throws** for a Schema it cannot compile (no finite path through a recursion, a declaration with no representation) |
| `Arbitrary.Constant(value)` (`:368`) | always that value, no shrinking; the branch value inside `flatMap` |
| `map` / `filter` / `filterMap` (`:383`–`:428`) | transform, keep, or transform-and-reject generated values (and their shrinks); rejections spend `maxDiscards` |
| `flatMap` (`:459`) | dependent generation — a generated value chooses the next `Arbitrary` |
| `all(tuple \| iterable \| record)` (`:485`) | independent members combined shape-for-shape |
| `sampleEffect(arb, { count, size, maxDiscards, seed })` (`:510`) | `Effect<ReadonlyArray<A>, SampleError>` — fails typed when discards exhaust the budget |
| `checkEffect(arb, property, CheckOptions)` (`:543`) | runs a pure or Effectful property and returns a **`CheckResult`** (`Passed \| Falsified \| Exhausted \| ReplayMismatch`) — it never throws for an ordinary falsification |
| `formatCheckFailure(result)` (`:298`) | the string `@effect/vitest` dies with: runs, shrinks, shrunk input, failure, **replay token** |
| `isArbitrary`, `CheckOptions`, `SampleOptions`, `Replay` | guard, option bags (`{ runs, size, maxDiscards, maxShrinks, seed, replay }` at `:166`), the opaque replay token |

**What it does NOT have, so stop looking:** no `oneof`, `constantFrom`,
`array`, `record`, `string`, `integer`, `option`, `weighted`/`frequency`, no
`sample`-that-throws and no `assert`. Choice, collections and scalars are all
expressed as **Schemas** and derived. The house translations, each taken from
a property test migrated on the rc.115 advance:

| fast-check habit | native spelling |
| --- | --- |
| `fc.constantFrom("a", "b")` | `Arbitrary.schema(Schema.Literals(["a", "b"]))` |
| `fc.integer({ min, max })` | `Schema.Int.check(Schema.isBetween({ minimum, maximum }))` — **bound it**: an unbounded `Schema.Int` generates within `±size²` (`±100` at the default size) rather than the 32-bit range |
| `fc.array(x, { minLength, maxLength })` | `Schema.Array(X).check(Schema.isLengthBetween(min, max))` |
| `fc.stringMatching(/^[a-z]{1,12}$/)` | `Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/))` — generated **constructively** when the pattern compiles (see traps) |
| `fc.record({ a: fc.option(x) })` — some keys absent | `Schema.Struct({ a: Schema.optionalKey(X) })` — **not** `Schema.Record(Literals, X)`, which always emits every key |
| `fc.oneof(arbA, arbB)` over *Arbitraries* (not Schemas) | `Schema.Union([A, B])` when both sides are Schemas; otherwise `flatMap` over a generated index: `Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: rest.length }))).pipe(Arbitrary.flatMap((i) => i === 0 ? first : rest[i - 1]))` |
| `fc.array(arb)` over an *Arbitrary* | `flatMap` a generated length into `Arbitrary.all(Array.from({ length }, () => item))` |
| `fc.option(arb, { nil: undefined })` | `Arbitrary.schema(Schema.Struct({ value: Schema.optionalKey(S) })).pipe(Arbitrary.map((o) => o.value))` |
| `fc.fullUnicodeString()` / `fc.string({ unit: "binary" })` | generate **code points** — `Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0x10ffff })))` (filter the surrogate block if the consumer needs scalar values) mapped through `String.fromCodePoint`; the native string generator stays in printable ASCII |
| `fc.sample(arb, n)` | `Effect.runPromise(Arbitrary.sampleEffect(arb, { count: n }))` |
| `fc.assert(fc.property(...), { numRuns })` | `it.prop` / `it.effect.prop` with `{ arbitrary: { runs } }`, or `checkEffect` and branch on `_tag` |

#### The size clamp — the trap that silently shrinks a domain

`size` (default **10** for both `sampleEffect` and `checkEffect`, `internal/arbitrary/runner.ts:425,566`)
is a *local complexity scale*: every unconstrained string, array and record
length is generated up to `min(maxLength, max(minLength, size))`
(`internal/arbitrary/schema.ts:1124-1125` for strings, `:1366-1367` for
arrays), and `checkEffect` ramps it from 0 toward `size` across the runs.
Probed at rc.115: `Schema.String.check(Schema.isMaxLength(40_000))` never
produced a string longer than **10** characters at the default size, and
produced a 40 000-character one with `{ size: 40_000 }`; `isMinLength(25)` is
still honored above the clamp. A property whose domain has a large cap
(a byte-budget truncation test, a "long input" parser test) **must pass
`arbitrary: { size: <cap> }`** or it exercises tiny inputs and passes for the
wrong reason. Numbers scale the same way: an unbounded `Schema.Int` has
magnitude `size²` (`schema.ts:1170`).

#### Filters, constraints, and exhaustion

Generated values are always validated by the schema's checks before they are
returned. Built-in checks (`isBetween`, `isMinLength`/`isMaxLength`/
`isLengthBetween`, `isPattern`, `isUnique`, `isInt`, …) carry an
`arbitraryConstraint` annotation (over twenty `arbitraryConstraint:` sites in `Schema.ts`, e.g. `isBetween` at `:7458`, `isMinLength` at `:8046`; `isPattern` delegates to `SchemaAST.isPattern`), so the compiler generates
matching values **constructively**. Any other check is a *residual filter*:
values are generated without it and rejected when they fail. Rejections are
budgeted (`maxDiscards`, default `max(100, count * 10)` / `max(100, runs * 10)`),
so a selective predicate no longer hangs the way the fast-check bridge did —
it **fails typed**:

```txt
SampleError { generated: 0, discards: 101, seed: 1 }   // sampleEffect
Exhausted   { runs, discards, seed }                    // checkEffect / it.prop
```

Probed at rc.115 against `@effected/npm`'s `IntegrityHash` — a brand whose
check is a `makeFilter` over three hash grammars with no
`arbitraryConstraint`: `Arbitrary.sampleEffect(Arbitrary.schema(IntegrityHash))`
fails with `SampleError { generated: 0, discards: 101 }` in under a
millisecond. Inside a `Struct` the same field, if `optionalKey`, is simply
never populated, so the property silently never exercises it. The fix is
never "raise `maxDiscards`" — it is one of:

- give the filter a constructive constraint —
  `Schema.makeFilter(pred, { arbitraryConstraint: { patterns: [{ source, flags }] } })`
  (or `minimum`/`maximum` + `order`, `minLength`/`maxLength`, `number: "integer" | "finite"`, `uniqueBy`; the shape is `Schema.Annotations.ToArbitrary.FilterConstraint`, `Schema.ts:15367` — the old `ToArbitrary.Constraint` name is gone);
- generate the leaf from a `Schema.Literals` of real values (the
  `packages/lockfiles/__test__/roundtrip.property.test.ts` shape);
- for a declaration, provide `toCodecArbitrary` — a `Schema.link` from an
  easily-generated representation, not a fast-check arbitrary (below).

#### Patterns the regexp compiler cannot take are dropped, not rejected

`internal/arbitrary/regexp.ts` compiles an `isPattern` regex into a
constructive generator. When it **cannot** — lookahead and lookbehind
(`regexp.ts:344` for `(?<=`/`(?<!`, `:350` for `(?=`/`(?!`), backreferences, the `i`/`m`/`v` flags
(`regexp.ts:832`) — `compile` returns `undefined` and the string node
**silently skips the pattern** (`schema.ts:1111-1112`), generating plain
random strings and leaving the regex as a residual filter. Probed at
rc.115, `{ count: 20, seed: 1 }` each:

| pattern | result |
| --- | --- |
| `/^[a-f]{8}$/` (control) | constructive, 20 samples |
| `/^(?=.*[0-9])[a-f0-9]{8}$/` | `SampleError { generated: 0, discards: 201 }` |
| `/^(?!x)[a-f]{8}$/` | `SampleError` |
| `/^[a-f]{8}$/i` | `SampleError` — the flag alone defeats it |
| `/^([a-f]{4})\1$/` | `SampleError` |
| `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` | 20 samples — but only because the fallback strings are biased toward identifiers like `toString`; a permissive lookahead *works by accident* |

So keep pattern schemas **lookaround-free and flag-free**, rewriting
`/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/` —
`packages/semver/src/SemVer.ts` and `packages/schema-org/src/NodeRef.ts` are
the house examples. Named groups (`(?<h>…)`) and non-capturing groups compile fine.

#### `-0` — the integer JSON cannot carry

The native generator emits **`-0`**: always as a legitimate double for
`Schema.Number` / `Schema.Finite`, and for `Schema.Int` whenever the effective
lower bound is `-1` — which is exactly what an **unbounded** `Schema.Int` has
during `checkEffect`'s early small-size runs (`numberBiasRanges`,
`internal/arbitrary/model.ts:561-565`: the near-zero bias range is
`{ minimum: -floor(log2(-min)), … }`, and `-floor(log2(1))` is `-0`). Probed
at rc.115: `checkEffect(Arbitrary.schema(Schema.Int), (n) => !Object.is(n, -0))`
is **Falsified after 5 runs**; `Schema.Int.check(isBetween({ minimum: -1, maximum: 1 }))`
likewise; a domain bounded at `-(2 ** 31)` passed 100 runs. `JSON.stringify(-0)`
is `"0"` and YAML has no `-0` either, so a round-trip property over serialized
numbers must exclude it explicitly rather than let `deepStrictEqual` fail on
`+0`/`-0`:

```ts
count: Schema.Int.check(Schema.makeFilter((n) => !Object.is(n, -0)))
```

(`packages/jsonc/__test__/Jsonc.test.ts` and `packages/yaml/__test__/Yaml.test.ts`
on the rc.115 advance carry this filter.)

#### Records, dictionaries and unique keys

`Schema.Record(Schema.Literals([...]), V)` **always emits every key** (probed:
200 samples, key count always 3), and `Schema.Array(Schema.Tuple([Key, V])).check(Schema.isUniqueKey())`
over a tiny key domain does sample the short lengths but never the *partial
dictionary* shape a lockfile or manifest actually carries. A dictionary whose
keys are each independently present or absent is a **Struct of `optionalKey`**
(probed: key counts `0, 1, 2, 3` all sampled):

```ts
const dictionary = <V extends Schema.Top>(keys: ReadonlyArray<string>, value: V) =>
  Arbitrary.schema(
    Schema.Struct(Object.fromEntries(keys.map((key) => [key, Schema.optionalKey(value)]))),
  ).pipe(Arbitrary.map((entries) => ({ ...entries }) as Record<string, V["Type"]>))
```

#### Unions of classes yield real instances

`Arbitrary.schema(Schema.Array(Schema.Union([A, B])))` over two `Schema.Class`es
generates **real instances** — `instanceof A` / `instanceof B` both hold and
every element is one or the other (probed at rc.115). Code under test that
branches on `instanceof` takes the real branch; no manual wiring.

#### Declaration Schemas: `toCodecArbitrary` returns a `Link`

Declaration schemas are opaque. Derivation looks, in order, for an explicit
`toCodecArbitrary`, a built-in representation, `toCodecJson`, then `toCodec` —
so a declaration that already serializes usually needs nothing. When the
canonical representation is opaque or generates valid values too rarely,
provide a **Schema `Link`** from an easily-generated source, not a fast-check
arbitrary (`Schema.Annotations.ToArbitrary.Declaration`, `Schema.ts:15239`):

```ts
import { Schema, SchemaTransformation } from "effect"

class UserId {
  constructor(readonly value: number) {}
}

const UserIdSchema = Schema.instanceOf(UserId, {
  toCodecArbitrary: () =>
    Schema.link<UserId>()(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
      SchemaTransformation.transform({
        decode: (value) => new UserId(value),
        encode: (id) => id.value
      })
    )
})
```

The declaration stays authoritative — values decoded by the link are checked
against it and rejections become bounded discards. The callback also receives
the decoded type-parameter schemas and the normalized constraints collected
from the declaration's checks. Recursion needs no terminal generator: the
compiler analyses the schema graph and throws from `Arbitrary.schema` if no
finite path exists.

#### Running a property outside vitest

```ts
const result = await Effect.runPromise(
  Arbitrary.checkEffect(Arbitrary.schema(Schema.Int), (n) => n < 5, { runs: 100, seed: 1 })
)
// result._tag === "Falsified"; result.shrunkInput === 5; result.replay is the token
console.log(Arbitrary.formatCheckFailure(result))
// Property falsified after 33 run(s) and 1 shrink(s)
// Shrunk input: 5
// Failure: returned false
// Replay: [0,"1",32,3,[1],"ReturnedFalse"]
```

Re-run with `{ replay: result.replay }` to reproduce the shrink path; a replay
token is only promised to work on the same unstable release, so preserve an
important counterexample as an explicit regression test rather than a token.
Inside `@effect/vitest` the same string is the test's failure message — see
`effect-v4-testing` for the runner's options and for the reporter that
compacts it.

#### Integration with Synthetic Data Generation Tools

A faker-style source is a *representation* a Schema can decode from, so it
goes through the same door as any declaration: generate a seed with Schema and
map it through the faker inside a `SchemaTransformation.transform`, or — for a
plain field — `Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 31 }))).pipe(Arbitrary.map((seed) => { faker.seed(seed); return faker.person.firstName() }))`.
The seed comes from the engine so the value is reproducible and shrinks with
it. Prefer Schema constraints and default derivation for anything numeric or
structural; reach for a faker only when values must *look* real.

### Generating an Equivalence from a Schema

An equivalence function checks whether two values are structurally equal according to the schema's definition. Schema derives this automatically, so you do not need to write manual comparison logic.

**Example** (Deriving equivalence for a basic schema)

```ts
import { Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.String,
  b: Schema.Number
})

const equivalence = Schema.toEquivalence(schema)
```

#### Declarations

**Example** (Providing a custom equivalence for a class)

```ts
import { Schema } from "effect"

class MyClass {
  constructor(readonly a: string) {}
}

const schema = Schema.instanceOf(MyClass, {
  toEquivalence: () => (x, y) => x.a === y.a
})

const equivalence = Schema.toEquivalence(schema)
```

#### Overrides

You can override the derived equivalence for a schema using `overrideToEquivalence`. This is useful when the default derivation does not fit your requirements.

**Example** (Overriding equivalence for a struct)

```ts
import { Equivalence, Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.String,
  b: Schema.Number
}).pipe(Schema.overrideToEquivalence(() => Equivalence.make((x, y) => x.a === y.a)))

const equivalence = Schema.toEquivalence(schema)
```

### Generating an Optic from a Schema

Optics provide a composable way to read and update deeply nested values without mutating the original object. Schema can derive optics automatically from your schema definition.

#### Problem

The `Optic` module only works with plain JavaScript objects and collections (structs, records, tuples, and arrays).
This can feel restrictive when working with custom types.

To work around this, you can define an `Iso` between your custom type and a plain JavaScript object.

**Example** (Defining an `Iso` manually between a custom type and a plain JavaScript object)

```ts
import { Optic, Schema } from "effect"

// Define custom schema-based classes
class A extends Schema.Class<A>("A")({ s: Schema.String }) {}
class B extends Schema.Class<B>("B")({ a: A }) {}

// Create an Iso that converts between B and a plain object
const iso = Optic.makeIso<B, { readonly a: { readonly s: string } }>(
  (s) => ({ a: { s: s.a.s } }), // forward transformation
  (a) => new B({ a: new A({ s: a.a.s }) }) // backward transformation
)

// Build an optic that drills down to the "s" field inside "a"
const _s = iso.key("a").key("s")

console.log(_s.replace("b", new B({ a: new A({ s: "a" }) })))
// B { a: A { s: 'b' } }
```

#### Solution

Manually creating `Iso` instances is repetitive and error-prone.
To simplify this, the library provides a helper function that generates an `Iso` directly from a schema.

This allows you to keep working with plain JavaScript objects and collections while still benefiting from schema definitions.

**Example** (Generating an `Iso` automatically from a schema)

```ts
import { Schema } from "effect"

class A extends Schema.Class<A>("A")({ s: Schema.String }) {}
class B extends Schema.Class<B>("B")({ a: A }) {}

// Automatically generate an Iso from the schema of B
// const iso: Iso<B, { readonly a: { readonly s: string } }>
const iso = Schema.toIso(B)

const _s = iso.key("a").key("s")

console.log(_s.replace("b", new B({ a: new A({ s: "a" }) })))
// B { a: A { s: 'b' } }
```

Reading through the generated `Iso` encodes the schema value, while replacing through it decodes the new focus. Either direction can throw an `Error` with the generic message `"Schema validation failed"` and a `SchemaIssue.Issue` in its `cause`. Use `SchemaIssue.makeFormatterDefault()` to format that cause when human-readable details are needed — the `Error` message itself carries no detail at all.

### Using the Differ Module for Type-Safe JSON Patches

The `Differ` module lets you compute and apply JSON Patch (RFC 6902) changes for any value described by a `Schema`. You give it a schema once, then use the returned differ to produce a patch from an old value to a new value, and to apply that patch.

**Example** (Compare two values and apply the patch)

```ts
import { Schema } from "effect"

// Describe the shape of your data
const schema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  price: Schema.Number
})

// Build a differ tied to the schema
const differ = Schema.toDifferJsonPatch(schema)

// Prepare two values to compare
const oldValue = { id: 1, name: "a", price: 1 }
const newValue = { id: 1, name: "b", price: 2 }

// Compute a JSON Patch document (an array of operations)
const jsonPatch = differ.diff(oldValue, newValue)
console.log(jsonPatch)
/*
[
  { op: 'replace', path: '/name', value: 'b' },
  { op: 'replace', path: '/price', value: 2 }
]
*/

// Apply the patch to the old value to get the new value
const patched = differ.patch(oldValue, jsonPatch)
console.log(patched)
// { id: 1, name: 'b', price: 2 }
```

#### Works with custom types too

**Example** (Compare two custom types)

```ts
import { Schema } from "effect"

class A extends Schema.Class<A>("A")({ n: Schema.Number }) {}
class B extends Schema.Class<B>("B")({ a: A }) {}

const differ = Schema.toDifferJsonPatch(B)

const oldValue = new B({ a: new A({ n: 0 }) })
const newValue = new B({ a: new A({ n: 1 }) })

const patch = differ.diff(oldValue, newValue)
console.log(patch)
// [ { op: 'replace', path: '/a/n', value: 1 } ]

console.log(differ.patch(oldValue, patch))
// B { a: A { n: 1 } }
```

#### How it works

The idea is simple: if you have a `Schema` for a type `T`, you can serialize any `T` to JSON and back. That lets us compute and apply JSON Patch on the JSON view, while keeping the public API typed as `T`.

- `diff(oldValue, newValue)`

  1. Encode `oldValue: T` and `newValue: T` to JSON with the schema serializer.
  2. Compute a JSON Patch document between the two JSON values.
  3. Return that patch (an array of `"add" | "remove" | "replace"` operations).

- `patch(oldValue, patch)`
  1. Encode `oldValue: T` to JSON.
  2. Apply the JSON Patch to the JSON value.
  3. Decode the patched JSON back to `T` using the schema.

This approach keeps patches independent from TypeScript types and uses the schema as the guardrail when turning JSON back into `T`.

Schema conversion failures from `diff` or `patch` throw an `Error` with the generic message `"Schema validation failed"` and a `SchemaIssue.Issue` in its `cause`. Format that cause explicitly with `SchemaIssue.makeFormatterDefault()`. Errors raised while applying an invalid JSON Patch operation are separate `JsonPatch` errors rather than schema validation failures.
