<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Constructors

A constructor creates a value of the schema's type, running all validations at the time of creation. If the value does not satisfy the schema, the constructor throws an error. Every schema exposes a `make` method for this purpose.

For an alternative that does not throw on schema validation failures, use `Schema.makeOption` (or `SchemaParser.makeOption`), which returns `Option.Some` on success and `Option.None` for schema issues. Non-schema failures, such as defects, still throw.

```ts
import { Schema, SchemaParser } from "effect"

const schema = Schema.Struct({
  a: Schema.Number.check(Schema.isGreaterThan(0))
})

console.log(schema.makeOption({ a: 1 }))
// { _id: 'Option', _tag: 'Some', value: { a: 1 } }

console.log(schema.makeOption({ a: -1 }))
// { _id: 'Option', _tag: 'None' }

// Equivalent standalone usage:
const parse = SchemaParser.makeOption(schema)

console.log(parse({ a: 1 }))
// { _id: 'Option', _tag: 'Some', value: { a: 1 } }
```

## Constructors in Composed Schemas

To support constructing values from composed schemas, `make` is now available on all schemas, including unions.

```ts
import { Schema } from "effect"

const schema = Schema.Union([Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.Number })])

schema.make({ a: "hello" })
schema.make({ b: 1 })
```

## Branded Constructors

Branding adds an invisible marker to a type so that values from different domains cannot be accidentally mixed — even when they have the same underlying shape (for example, both are `string`). For branded schemas, the default constructor accepts an unbranded input and returns a branded output.

```ts
import { Schema } from "effect"

const schema = Schema.String.pipe(Schema.brand<"a">())

// make(input: string, options?: Schema.MakeOptions): string & Brand<"a">
schema.make
```

However, when a branded schema is part of a composite (such as a struct), you must pass a branded value.

```ts
import { Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.String.pipe(Schema.brand<"a">()),
  b: Schema.Number
})

/*
make(input: {
    readonly a: string & Brand<"a">;
    readonly b: number;
}, options?: Schema.MakeOptions): {
    readonly a: string & Brand<"a">;
    readonly b: number;
}
*/
schema.make
```

## Refined Constructors

For refined schemas, the constructor accepts the unrefined type and returns the refined one.

```ts
import { Option, Schema } from "effect"

const schema = Schema.Option(Schema.String).pipe(Schema.refine(Option.isSome))

// make(input: Option.Option<string>, options?: Schema.MakeOptions): Option.Some<string>
schema.make
```

As with branding, when used in a composite schema, the refined value must be provided.

```ts
import { Option, Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.Option(Schema.String).pipe(Schema.refine(Option.isSome)),
  b: Schema.Number
})

/*
make(input: {
    readonly a: Option.Some<string>;
    readonly b: number;
}, options?: Schema.MakeOptions): {
    readonly a: Option.Some<string>;
    readonly b: number;
}
*/
schema.make
```

## Default Values in Constructors

You can define a default value for a field using `Schema.withConstructorDefault`. If no value is provided at runtime (either the key is missing or the value is `undefined`), the constructor uses this default.

**Example** (Providing a default number)

```ts
import { Effect, Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.Number.pipe(Schema.withConstructorDefault(Effect.succeed(-1)))
})

console.log(schema.make({ a: 5 }))
// { a: 5 }

console.log(schema.make({}))
// { a: -1 }
```

The Effect passed to `withConstructorDefault` will be executed each time a default value is needed.

**Example** (Re-executing the default function)

```ts
import { Effect, Schema } from "effect"

let counter = 0

const schema = Schema.Struct({
  a: Schema.Date.pipe(Schema.withConstructorDefault(Effect.sync(() => new Date(counter++))))
})

console.log(schema.make({}))
// { a: 1970-01-01T00:00:00.000Z }

console.log(schema.make({}))
// { a: 1970-01-01T00:00:00.001Z }
```

### Nested Constructor Default Values

Default values can be nested inside composed schemas. In this case, inner defaults are resolved first.

**Example** (Nested default values)

```ts
import { Effect, Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.Struct({
    b: Schema.Number.pipe(Schema.withConstructorDefault(Effect.succeed(-1)))
  }).pipe(Schema.withConstructorDefault(Effect.succeed({})))
})

console.log(schema.make({}))
// { a: { b: -1 } }
console.log(schema.make({ a: {} }))
// { a: { b: -1 } }
```

## Effectful Defaults

Default values can also come from an `Effect`, for example, reading from a configuration service or performing an asynchronous operation. The environment must be `never` (no required services).

**Example** (Using an effect to provide a default)

```ts
import { Effect, Schema, SchemaParser } from "effect"

const schema = Schema.Struct({
  a: Schema.Number.pipe(
    Schema.withConstructorDefault(
      Effect.gen(function*() {
        yield* Effect.sleep(100)
        return -1
      })
    )
  )
})

SchemaParser.makeEffect(schema)({}).pipe(Effect.runPromise).then(console.log)
// { a: -1 }
```

**Example** (Providing a default from an optional service)

```ts
import { Context, Effect, Option, Schema, SchemaParser } from "effect"

// Define a service that may provide a default value
class ConstructorService extends Context.Service<ConstructorService, { defaultValue: Effect.Effect<number> }>()(
  "ConstructorService"
) {}

const schema = Schema.Struct({
  a: Schema.Number.pipe(
    Schema.withConstructorDefault(
      Effect.gen(function*() {
        yield* Effect.sleep(100)
        const oservice = yield* Effect.serviceOption(ConstructorService)
        if (Option.isNone(oservice)) {
          return -1
        }
        return yield* oservice.value.defaultValue
      })
    )
  )
})

SchemaParser.makeEffect(schema)({})
  .pipe(
    Effect.provideService(ConstructorService, ConstructorService.of({ defaultValue: Effect.succeed(0) })),
    Effect.runPromise
  )
  .then(console.log, console.error)
// { a: 0 }
```
