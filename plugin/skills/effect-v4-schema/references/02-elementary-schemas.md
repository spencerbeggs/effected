<!--
Vendored from the Effect canonical Schema guide (Effect-TS/effect, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect v4 beta in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect/blob/main/packages/effect/SCHEMA.md

API surface audited against effect@4.0.0-beta.107: every Schema/SchemaGetter/SchemaParser/
SchemaTransformation member named here exists, and every code block with imports typechecks.
Three claims were FALSIFIED and are corrected inline with trap notes: the `effect/schema` subpath
with its `Getter`/`Parser` modules (neither the path nor the module names exist — use `SchemaGetter`
and `SchemaParser` from `effect`), `Schema.String.decode(...)` as a method (`decode` is a combinator
applied through `.pipe`), and the claim that `Schema.Date` accepts invalid dates with a companion
`Schema.DateValid` (Schema.Date already rejects NaN dates; DateValid does not exist).
PROBED on beta.107: the coercion outputs, and the absence of the `, got X` suffix in default-mode
error messages — those suffixes were removed from the expected output here.
-->

# Defining Elementary Schemas

Schema provides built-in schemas for all common TypeScript types. These schemas represent a single value — like a string or a number — and they are the building blocks you combine into more complex shapes.

## Primitives

Use these schemas when a value should be exactly one of the basic JavaScript types.

```ts
import { Schema } from "effect"

// primitive types
Schema.String
Schema.Number
Schema.BigInt
Schema.Boolean
Schema.Symbol
Schema.Undefined
Schema.Null
```

Sometimes you receive data that is not the right type yet — for example, a number that should become a string. You can build a schema that converts (coerces) values to the target type during decoding:

> **Beta trap.** There is no `effect/schema` subpath and no `Getter` / `Parser`
> module. The `effect` package exports `SchemaGetter` and `SchemaParser` as
> top-level modules. `import { Getter, Parser } from "effect/schema"` is not a
> naming preference — it does not resolve.

```ts
import { Schema, SchemaGetter, SchemaParser } from "effect"

//      ┌─── Codec<string, unknown>
//      ▼
const schema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.String(),
    encode: SchemaGetter.passthrough()
  })
)

const parser = SchemaParser.decodeUnknownSync(schema)

console.log(parser("tuna")) // => "tuna"
console.log(parser(42)) // => "42"
console.log(parser(true)) // => "true"
console.log(parser(null)) // => "null"
```

## Literals

A literal schema matches one exact value. Use it when a field must be a specific string, number, or other constant.

```ts
import { Schema } from "effect"

const tuna = Schema.Literal("tuna")
const twelve = Schema.Literal(12)
const twobig = Schema.Literal(2n)
const tru = Schema.Literal(true)
```

Symbol literals:

```ts
import { Schema } from "effect"

const terrific = Schema.UniqueSymbol(Symbol("terrific"))
```

`null`, `undefined`, and `void`:

```ts
import { Schema } from "effect"

Schema.Null
Schema.Undefined
Schema.Void
```

To allow multiple literal values:

```ts
import { Schema } from "effect"

const schema = Schema.Literals(["red", "green", "blue"])
```

To extract the set of allowed values from a literal schema:

```ts
import { Schema } from "effect"

const schema = Schema.Literals(["red", "green", "blue"])

// readonly ["red", "green", "blue"]
schema.literals

// readonly [Schema.Literal<"red">, Schema.Literal<"green">, Schema.Literal<"blue">]
schema.members
```

## Strings

You can add validation rules to a string schema. Each rule is applied with `.check(...)` and returns a new schema that enforces that constraint.

```ts
import { Schema } from "effect"

Schema.String.check(Schema.isMaxLength(5))
Schema.String.check(Schema.isMinLength(5))
Schema.String.check(Schema.isLengthBetween(5, 5))
Schema.String.check(Schema.isPattern(/^[a-z]+$/))
Schema.String.check(Schema.isStartsWith("aaa"))
Schema.String.check(Schema.isEndsWith("zzz"))
Schema.String.check(Schema.isIncludes("---"))
Schema.String.check(Schema.isUppercased())
Schema.String.check(Schema.isLowercased())
```

To perform some simple string transforms:

```ts
import { Schema, SchemaTransformation } from "effect"

Schema.String.pipe(Schema.decode(SchemaTransformation.trim()))
Schema.String.pipe(Schema.decode(SchemaTransformation.toLowerCase()))
Schema.String.pipe(Schema.decode(SchemaTransformation.toUpperCase()))
```

> **Beta trap.** `decode` is a standalone combinator applied through `.pipe(...)`,
> not a method on the schema. `Schema.String.decode(...)` does not typecheck —
> schemas expose `.check`, `.annotate` and `.pipe`, but no `.decode`.

## String formats

Schema includes built-in checks for common string formats.

```ts
import { Schema } from "effect"

Schema.String.check(Schema.isUUID())
Schema.String.check(Schema.isBase64())
Schema.String.check(Schema.isBase64Url())
```

## Numbers

```ts
import { Schema } from "effect"

Schema.Number // all numbers
Schema.Finite // finite numbers (i.e. not +/-Infinity or NaN)
```

You can add validation rules to a number schema. Each rule constrains the allowed range or value.

```ts
import { Schema } from "effect"

Schema.Number.check(Schema.isBetween({ minimum: 5, maximum: 10 }))
Schema.Number.check(Schema.isGreaterThan(5))
Schema.Number.check(Schema.isGreaterThanOrEqualTo(5))
Schema.Number.check(Schema.isLessThan(5))
Schema.Number.check(Schema.isLessThanOrEqualTo(5))
Schema.Number.check(Schema.isMultipleOf(5))
```

## Integers

To require that a number has no decimal part, use `isInt()`. For 32-bit integers specifically, use `isInt32()`.

```ts
import { Schema } from "effect"

Schema.Number.check(Schema.isInt())
Schema.Number.check(Schema.isInt32())
```

## BigInts

Schema does not ship pre-built BigInt validation factories (unlike numbers). Instead, you create your own using helper functions and a BigInt-compatible ordering. The example below shows how.

```ts
import { BigInt, Order, Schema } from "effect"

const options = { order: Order.BigInt }

const isBetween = Schema.makeIsBetween(options)
const isGreaterThan = Schema.makeIsGreaterThan(options)
const isGreaterThanOrEqualTo = Schema.makeIsGreaterThanOrEqualTo(options)
const isLessThan = Schema.makeIsLessThan(options)
const isLessThanOrEqualTo = Schema.makeIsLessThanOrEqualTo(options)
const isMultipleOf = Schema.makeIsMultipleOf({
  remainder: BigInt.remainder,
  zero: 0n
})

const isPositive = isGreaterThan(0n)
const isNonNegative = isGreaterThanOrEqualTo(0n)
const isNegative = isLessThan(0n)
const isNonPositive = isLessThanOrEqualTo(0n)

Schema.BigInt.check(isBetween({ minimum: 5n, maximum: 10n }))
Schema.BigInt.check(isGreaterThan(5n))
Schema.BigInt.check(isGreaterThanOrEqualTo(5n))
Schema.BigInt.check(isLessThan(5n))
Schema.BigInt.check(isLessThanOrEqualTo(5n))
Schema.BigInt.check(isMultipleOf(5n))
Schema.BigInt.check(isPositive)
Schema.BigInt.check(isNonNegative)
Schema.BigInt.check(isNegative)
Schema.BigInt.check(isNonPositive)
```

## Dates

The `Schema.Date` schema matches valid `Date` objects and rejects invalid dates
such as `new Date(NaN)`. Its guard is `input instanceof Date && !Number.isNaN(input.getTime())`
and its `expected` annotation is `"a valid Date"`.

> **Beta trap.** There is no separate "valid date" schema. `Schema.DateValid`
> and `Schema.ValidDate` are both `undefined` — earlier drafts of this guide
> described `Schema.Date` as accepting invalid dates and pointed at a companion
> schema to exclude them. `Schema.Date` already excludes them.

## Template literals

You can use `Schema.TemplateLiteral` to define structured string patterns made of multiple parts. Each part can be a literal or a schema, and **additional constraints** (such as `isMinLength` or `isMaxLength`) can be applied to individual parts.

Template literal matching is based on the semantics of each part rather than only a generated regular expression. Checks on string, number, and bigint schema parts are applied while matching each segment.

**Example** (Constraining parts of an email-like string)

```ts
import { Schema } from "effect"

// Construct a template literal schema for values like `${string}@${string}`
// Apply constraints to both sides of the "@" symbol
const email = Schema.TemplateLiteral([
  // Left part: must be a non-empty string
  Schema.String.check(Schema.isMinLength(1)),

  // Separator
  "@",

  // Right part: must be a string with a maximum length of 64
  Schema.String.check(Schema.isMaxLength(64))
])

// The inferred type is `${string}@${string}`
export type Type = typeof email.Type

console.log(String(Schema.decodeUnknownExit(email)("a@b.com")))
/*
Success("a@b.com")
*/

console.log(String(Schema.decodeUnknownExit(email)("@b.com")))
/*
Failure(Cause([Fail(SchemaError(Expected a string matching template literal parts))]))
*/
```

### Template literal parser

If you want to extract the parts of a string that match a template, you can use `Schema.TemplateLiteralParser`. This allows you to parse the input into its individual components rather than treat it as a single string.

**Example** (Parsing a template literal into components)

```ts
import { Schema } from "effect"

const schema = Schema.TemplateLiteralParser([
  Schema.String.check(Schema.isMinLength(2)),
  ":",
  Schema.Int
])

// The inferred type is `readonly [string, ":", number]`
export type Type = typeof schema.Type

console.log(String(Schema.decodeUnknownExit(schema)("aa:1")))
// Success(["aa",":",1])

console.log(String(Schema.decodeUnknownExit(schema)("a:1")))
// Failure(Cause([Fail(SchemaError(Expected a value with a length of at least 2
//   at [0]))]))

console.log(String(Schema.decodeUnknownExit(schema)("aa:1.2")))
// Failure(Cause([Fail(SchemaError(Expected an integer
//   at [2]))]))
```
