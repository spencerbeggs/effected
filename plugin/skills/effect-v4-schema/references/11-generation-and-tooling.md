<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect v4 beta in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
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
    "additionalProperties": false
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
    "additionalProperties": false
  },
  "definitions": {}
}
*/
```

#### Defining a JSON-safe representation for custom types

This example shows how `Schema.toCodecJson` and `Schema.toJsonSchema` can describe the same JSON shape for a custom type.

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
  "additionalProperties": false
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
      "additionalProperties": false
    }
  },
  "definitions": {}
}
*/
```

### Generating an Arbitrary from a Schema

Property-based tests need generators. `Schema.toArbitrary` derives a
`fast-check` `Arbitrary` that generates decoded `Type` values accepted by the
schema.

Most schemas do not need any extra work:

```ts
import { Schema } from "effect"
import { FastCheck } from "effect/testing"

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Int.check(Schema.isBetween({ minimum: 18, maximum: 80 }))
})

const PersonArbitrary = Schema.toArbitrary(Person)

console.log(FastCheck.sample(PersonArbitrary, 3))
```

Use `Schema.toArbitraryLazy` only when you want the caller to provide
`fast-check`:

```ts
import { Schema } from "effect"
import { FastCheck } from "effect/testing"

const makeStringArbitrary = Schema.toArbitraryLazy(Schema.String)

const StringArbitrary = makeStringArbitrary(FastCheck)
```

`Schema.Never` and declaration schemas without a `toArbitrary` annotation cannot
be derived automatically.

#### Filters

Generated values are always checked by the schema filters before they are
returned. The important question is whether a filter can also help choose a good
generator.

Built-in filters already do this:

```ts
import { Schema } from "effect"

const Username = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(20),
  Schema.isPattern(/^[a-z0-9_]+$/)
)

const PositiveInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
)

const Tags = Schema.Array(Schema.String).check(
  Schema.isMinLength(1),
  Schema.isUnique()
)
```

For these schemas, `toArbitrary` does not generate random unconstrained strings,
numbers, or arrays and then hope the filters pass. It uses the length, range,
pattern, and uniqueness metadata to build a better generator first.

A custom filter without metadata is still correct, but may be inefficient:

```ts
import { Schema } from "effect"

const isPalindrome = (s: string) => s === Array.from(s).reverse().join("")

const Palindrome = Schema.String.check(
  Schema.makeFilter(isPalindrome, {
    expected: "a palindrome"
  })
)
```

This works because the final predicate check rejects strings that are not
palindromes. It may need many attempts, because the base string generator has no
reason to produce mirrored strings.

#### Reports

Use `{ report: true }` when you want to know which filters did not guide
generation:

```ts
import { Schema } from "effect"

const isPalindrome = (s: string) => s === Array.from(s).reverse().join("")

const Palindrome = Schema.String.check(
  Schema.makeFilter(isPalindrome, {
    expected: "a palindrome"
  })
)

const result = Schema.toArbitrary(Palindrome, { report: true })

result.value
result.report.warnings
```

An `OpaqueFilter` warning means: "this filter is still checked, but it did not
help build the generator."

Reports contain warnings only. Unsupported schemas, impossible constraints,
invalid candidates, and recursive schemas without a finite terminal path still
fail immediately.

#### Custom Filters With Constraints

If part of a custom filter can be described as a normal generation constraint,
attach `arbitrary.constraint` to the filter. The constraint does not have to
prove the whole predicate; it just makes the base generator closer to the values
the predicate accepts.

```ts
import { Order, Schema } from "effect"

const isPrimeNumber = (n: number) => {
  if (!Number.isInteger(n) || n < 2) {
    return false
  }
  for (let divisor = 2; divisor * divisor <= n; divisor++) {
    if (n % divisor === 0) {
      return false
    }
  }
  return true
}

const prime = Schema.makeFilter(isPrimeNumber, {
  expected: "a prime number",
  arbitrary: {
    constraint: {
      integer: true,
      ordered: {
        order: Order.Number,
        minimum: 2
      }
    }
  }
})

const Prime = Schema.Number.check(prime)
```

The filter still checks primality. The constraint only tells `toArbitrary` not
to waste time on non-integers or numbers below `2`.

Think of `constraint` as a small vocabulary that the current schema node can
understand:

- On strings, `minLength` and `maxLength` mean string length.
- On arrays, `minLength` and `maxLength` mean array length.
- On objects, `minLength` and `maxLength` mean final own-property count.
- On sets, maps, hash collections, and chunks, `minLength` and `maxLength` mean final collection size.
- `patterns` apply to string generation.
- `integer`, `noNaN`, `noInfinity`, `valid`, and `unique` are enabled when any contributing filter sets them.
- `ordered` stores bounds for ordered values such as numbers, bigints, dates, `DateTime`, and `BigDecimal`.

Fields that do not make sense for the current node are ignored. The final filter
check still validates every generated value.

#### Custom Filters With Candidates

Use a candidate when the filter cannot be expressed with the constraint
vocabulary.

```ts
import { Schema } from "effect"

const reverse = (s: string) => Array.from(s).reverse().join("")

const isPalindrome = (s: string) => s === reverse(s)

const palindrome = Schema.makeFilter(
  isPalindrome,
  {
    expected: "a palindrome",
    arbitrary: {
      candidate: {
        weight: 5,
        make: (fc) => fc.string().map((half) => `${half}${reverse(half)}`)
      }
    }
  }
)

const Palindrome = Schema.String.check(palindrome)
```

A candidate is an extra source used together with the schema node's base
generator. The base generator has weight `1`. A candidate has weight `1` unless
you set another positive integer weight.

With one candidate at weight `5`, fast-check tries the candidate roughly five
times as often as the base generator. Candidate values are still checked by all
filters, so a bad candidate can waste attempts but cannot produce invalid
values.

`make` receives the arbitrary context and may return `undefined` when the
candidate should not be used for that context.

#### Schema-Level Overrides

Use a `toArbitrary` annotation when you want to replace the generator for a
schema node.

The annotation is not limited to declaration schemas. You can attach it to a
normal schema with `.annotate(...)`:

```ts
import { Schema } from "effect"

const Name = Schema.String.annotate({
  toArbitrary: () => (fc) => fc.constantFrom("Alice", "Bob", "Carol")
})
```

Put override annotations on base schemas when possible, before adding filters:

```ts
const Name = Schema.String.annotate({
  toArbitrary: () => (fc) => fc.constantFrom("Alice", "Bob", "Carol")
}).check(Schema.isMinLength(1))
```

This shape is easier to reason about. The override provides the base generator;
the filter remains a normal filter. Schema still checks generated values at the
end.

Avoid putting an override on a schema that already has filters unless the
override intentionally handles those filters too:

```ts
const Name = Schema.String.check(Schema.isMinLength(1)).annotate({
  toArbitrary: () => (fc) => fc.constant("")
})
```

This is valid TypeScript, but it is a bad generator: it always generates a value
that the filter rejects.

The second argument of a `toArbitrary` hook is the arbitrary context. Its
`constraint` field contains constraints collected from filters on the same
schema node as the override. If the override is placed before `.check(...)`, the
context does not include the later filters. If the override is placed after
`.check(...)`, the context includes those filters and the override must respect
them.

`context.recursion` is present while deriving inside a recursive schema.

#### Declaration Schemas

Declaration schemas are opaque to Schema. If you define one, provide a
`toArbitrary` hook.

For an atomic declaration, return a normal `fast-check` arbitrary:

```ts
import { Schema } from "effect"

const Url = Schema.instanceOf(globalThis.URL, {
  title: "URL",
  toArbitrary: () => (fc) => fc.webUrl().map((s) => new globalThis.URL(s))
})
```

Generic declarations receive one derivation per type parameter:

- `arbitrary`: the normal generator for the type parameter.
- `terminal`: a finite generator for the type parameter, used to close recursive generation.

For an opaque wrapper type, you usually map both sources in the same way:

```ts
import { Effect, Option, Schema, SchemaIssue, SchemaParser } from "effect"

class Box<A> {
  private constructor(private readonly value: A) {}

  static make<A>(value: A): Box<A> {
    return new Box(value)
  }

  static unbox<A>(box: Box<A>): A {
    return box.value
  }
}

const isBox = (u: unknown): u is Box<unknown> => u instanceof Box

const BoxSchema = <A extends Schema.Top>(value: A) =>
  Schema.declareConstructor<Box<A["Type"]>, Box<A["Encoded"]>>()(
    [value],
    ([valueCodec]) => (input, ast, options) => {
      if (!isBox(input)) {
        return Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(input)))
      }
      return Effect.map(
        SchemaParser.decodeUnknownEffect(valueCodec)(Box.unbox(input), options),
        Box.make
      )
    },
    {
      toArbitrary: ([value]) => () => ({
        arbitrary: value.arbitrary.map(Box.make),
        terminal: value.terminal?.map(Box.make)
      })
    }
  )
```

This looks like duplicated code, but it is not the same generator twice. It is
the same opaque constructor applied to two different sources.

Suppose someone later builds a recursive schema like this:

```ts
interface Tree<A> {
  readonly value: A
  readonly children: ReadonlyArray<Tree<A>>
}

type BoxedTree<A> = Box<Tree<A>>
```

`Box` does not know whether `A` is recursive. If `A` is `Tree<A>`, then
`value.arbitrary` may generate a recursive tree, while `value.terminal` is the
finite tree generator used when the recursion budget is exhausted. Mapping both
sources through `Box.make` preserves that information. If `Box` returned only
`arbitrary`, it would hide the finite path from outer recursive schemas.

If the type parameter has no finite terminal generator, `value.terminal` is
`undefined`, and the wrapper cannot provide a terminal branch either.

#### Integration with Synthetic Data Generation Tools

Synthetic data libraries such as `@faker-js/faker` are useful when the generated
values should look realistic. Put them behind a Fast-Check arbitrary instead of
calling them directly, so Fast-Check still controls randomness and shrinking.

```ts
import { faker } from "@faker-js/faker"
import { Schema } from "effect"
import { FastCheck } from "effect/testing"

/**
 * Make it easy to plug a Faker generator into a Schema's `toArbitrary` override.
 * The seed comes from Fast-Check so data is reproducible and shrinks correctly.
 */
function fake<A>(
  gen: (f: typeof faker) => A
): Schema.Annotations.ToArbitrary.Declaration<A, readonly []> {
  return () => (fc) =>
    fc.nat().map((seed) => {
      faker.seed(seed)
      return gen(faker)
    })
}

const FirstName = Schema.String.annotate({
  toArbitrary: fake((faker) => faker.person.firstName())
})

const LastName = Schema.String.annotate({
  toArbitrary: fake((faker) => faker.person.lastName())
})

const JobTitle = Schema.String.annotate({
  toArbitrary: fake((faker) => faker.person.jobTitle())
})

const Company = Schema.String.annotate({
  toArbitrary: fake((faker) => faker.company.name())
})

const Person = Schema.Struct({
  firstName: FirstName,
  lastName: LastName,
  jobTitle: JobTitle,
  company: Company
})

console.log(FastCheck.sample(Schema.toArbitrary(Person), 3))
```

These overrides are useful because the values have domain shape: names look like
names, job titles look like job titles, and companies look like companies. For
plain numeric ranges, prefer Schema constraints and the default arbitrary
derivation.

If you combine a Faker source with filters, put the override on the base schema
first and add filters afterwards. This keeps the responsibilities simple: the
override chooses a realistic source, and the filter remains the final validation
rule. If you put the override after `.check(...)`, the override must respect
those filters itself, or generation will spend time producing values that are
rejected.

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
