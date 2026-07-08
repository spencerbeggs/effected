<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Declaring Custom Types

When none of the built-in schema combinators fit your data type, use `Schema.declare` or `Schema.declareConstructor`.

## `Schema.declare` (non-parametric types)

`Schema.declare` creates a schema from a **type guard** — a function that checks whether an unknown value is of a given type. This is useful when you have a type that doesn't fit the built-in combinators (like `Struct`, `Array`, etc.) and you need to teach Schema how to recognize it.

```ts
Schema.declare<T>(
  is: (u: unknown) => u is T,
  annotations?: { expected?: string; toCodecJson?: ...; ... }
)
```

The first argument is your type guard. Schema will call it on any input value: if it returns `true`, decoding succeeds; if `false`, decoding fails.

**Example** (Creating a schema for `URL`)

```ts
import { Schema } from "effect"

// The type guard tells Schema how to recognize a URL instance
const URLSchema = Schema.declare(
  (u): u is URL => u instanceof URL
)

console.log(String(Schema.decodeUnknownExit(URLSchema)(new URL("https://example.com"))))
// Success(https://example.com/)

console.log(String(Schema.decodeUnknownExit(URLSchema)(null)))
// Failure(Cause([Fail(SchemaError(Expected <Declaration>, got null))]))
```

> **Tip**: For simple `instanceof` checks, prefer `Schema.instanceOf(URL)`, it wraps `Schema.declare` with an `instanceof` guard automatically.

### Customizing the error message with `expected`

The default error message `Expected <Declaration>` is not very descriptive. Use the `expected` annotation (second argument) to provide a human-readable name for your type.

**Example** (Adding an `expected` annotation)

```ts
import { Schema } from "effect"

const URLSchema = Schema.declare(
  (u): u is URL => u instanceof URL,
  { expected: "URL" }
)

console.log(String(Schema.decodeUnknownExit(URLSchema)(null)))
// Failure(Cause([Fail(SchemaError(Expected URL, got null))]))
//                                          ^^^
//                          Now the error message shows "URL" instead of "<Declaration>"
```

### Adding JSON support with `toCodecJson`

`Schema.toCodecJson` derives a codec that can convert your type **to and from JSON**. By default, declared schemas have no JSON representation — encoding produces `null`:

```ts
import { Schema } from "effect"

const URLSchema = Schema.declare(
  (u): u is URL => u instanceof URL,
  { expected: "URL" }
)

// Derive a JSON codec from the schema
const codec = Schema.toCodecJson(URLSchema)

// Encoding a URL produces null because Schema doesn't know
// how to serialize a URL to JSON yet
console.log(String(Schema.encodeUnknownExit(codec)(new URL("https://example.com"))))
// Success(null)
```

To fix this, provide a `toCodecJson` annotation. This annotation is a function that returns an `AST.Link`, a bridge that describes how to convert between your custom type and a JSON-friendly representation.

You build a `Link` using `Schema.link<T>()`, which takes two arguments:

1. **A JSON-side schema** — the shape of the JSON value (e.g. `Schema.String` for a URL string)
2. **A transformation** — how to convert back and forth between your type and the JSON value

**Example** (Making `URL` JSON-serializable)

```ts
import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect"

const URLSchema = Schema.declare(
  (u): u is URL => u instanceof URL,
  {
    expected: "URL",
    // Teach Schema how to convert URL <-> JSON
    toCodecJson: () =>
      Schema.link<globalThis.URL>()(
        // The JSON representation is a plain string
        Schema.String,
        // How to convert between URL and string
        SchemaTransformation.transformOrFail<URL, string>({
          // JSON string -> URL (may fail if the string is not a valid URL)
          decode: (s) =>
            Effect.try({
              try: () => new URL(s),
              catch: (e) => new SchemaIssue.InvalidValue(Option.some(s), { message: globalThis.String(e) })
            }),
          // URL -> JSON string (always succeeds)
          encode: (url) => Effect.succeed(url.href)
        })
      )
  }
)

const codec = Schema.toCodecJson(URLSchema)

// Now encoding produces the URL's href string
console.log(String(Schema.encodeUnknownExit(codec)(new URL("https://example.com"))))
// Success("https://example.com/")

// And decoding parses a string back into a URL
console.log(String(Schema.decodeUnknownExit(codec)("https://example.com")))
// Success(https://example.com/)
```

## `Schema.declareConstructor` (parametric types)

While `Schema.declare` works for fixed types like `URL` or `File`, some types are **generic** — they contain other types as parameters. Think of `Array<A>`, `Option<A>`, or a custom `Box<A>`. The schema for `Box<number>` is different from `Box<string>` because the inner value has a different type.

`Schema.declareConstructor` handles this by letting you define a **schema factory**: a function that takes schemas for the type parameters and returns a schema for the full type.

> **Important:** `declareConstructor` is for types where the **container shape is the same** on both sides: only the inner type parameter changes (e.g. `Box<Encoded>` to `Box<Type>`). If you need to convert a structurally different type into your declared type (e.g. `T` to `Box<T>`), first declare `Box` with `declareConstructor`, then define a separate transformation schema to express the conversion.

### How the two-step call works

`declareConstructor` uses a curried (two-step) call pattern:

```ts
Schema.declareConstructor<Type, Encoded>()(
  typeParameters, // array of schemas, one per type parameter
  run, // factory that produces the parsing function
  annotations // optional metadata (same as Schema.declare)
)
```

1. **Outer call** `declareConstructor<Type, Encoded>()` — fixes the TypeScript types. `Type` is the decoded type, `Encoded` is the encoded type.
2. **Inner call** `(typeParameters, run, annotations)` — provides the runtime behavior:
   - `typeParameters` — an array of schemas, one for each type variable (e.g. `[itemSchema]` for `Box<A>`)
   - `run` — a function that receives **resolved codecs** for those type parameters and returns a **parsing function** `(input, ast, options) => Effect<T, Issue>`
   - `annotations` — optional metadata like `expected`, `toCodecJson`, etc.

The parsing function you return from `run` is responsible for:

1. Checking that the input has the right shape (e.g. is an object with a `value` property)
2. Recursively decoding inner values using the provided codecs
3. Returning an `Effect` that succeeds with the decoded value or fails with an issue

**Example** (A generic `Box<A>` container)

```ts
import { Effect, Option, Schema, SchemaIssue, SchemaParser } from "effect"

// 1. Define the type
interface Box<A> {
  readonly value: A
}

// 2. A type guard that checks the shape (ignoring the inner type)
const isBox = (u: unknown): u is Box<unknown> => typeof u === "object" && u !== null && "value" in u

// 3. Create a schema factory: given a schema for A, return a schema for Box<A>
const Box = <A extends Schema.Top>(item: A) =>
  Schema.declareConstructor<Box<A["Type"]>, Box<A["Encoded"]>>()(
    // Pass the inner schema as a type parameter
    [item],
    // `run` receives the resolved codec for `item`
    ([itemCodec]) =>
    // Return the parsing function
    (u, ast, options) => {
      // First, check the outer shape
      if (!isBox(u)) {
        return Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(u)))
      }
      // Then, decode the inner value using the item codec
      return Effect.mapBothEager(
        SchemaParser.decodeUnknownEffect(itemCodec)(u.value, options),
        {
          onSuccess: (value) => ({ value }),
          // Wrap inner errors with a Pointer so the error path shows ["value"]
          onFailure: (issue) => new SchemaIssue.Pointer(["value"], issue)
        }
      )
    }
  )

// Use it: Box<number> that decodes strings to finite numbers
const schema = Box(Schema.FiniteFromString)

console.log(String(Schema.decodeUnknownExit(schema)({ value: "1" })))
// Success({ value: 1 })

console.log(String(Schema.decodeUnknownExit(schema)({ value: "a" })))
// Failure(Cause([Fail(SchemaError(Expected a finite number, got NaN
//   at ["value"]))]))
```

> `declareConstructor` accepts the same `annotations` as `declare` — including `expected` (for custom error messages) and `toCodecJson` (for JSON serialization). See the [`Schema.declare` section above](#schemadeclare-non-parametric-types) for details on how to use them.
