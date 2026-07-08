<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Middlewares

A middleware wraps around the decoding or encoding process, letting you intercept errors, provide fallback values, or inject services. The most common use case is returning a default value when decoding fails.

## Fallbacks

You can use `Schema.catchDecoding` to return a fallback value when decoding fails.
This API uses an Effect without a context. If you need a fallback value that depends on a service, use `Schema.catchDecodingWithContext`.

**Example** (Returning a simple fallback value)

```ts
import { Effect, Schema } from "effect"

// Provide a fallback string when decoding does not succeed
const schema = Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedSome("b")))

console.log(String(Schema.decodeUnknownExit(schema)(null)))
// Success("b")
```

You can also return `Option.none()` to omit a field from the output.
This is useful when working with optional fields.

**Example** (Omitting a field when decoding fails)

```ts
import { Effect, Schema } from "effect"

// Omit the field when decoding does not succeed
const schema = Schema.Struct({
  a: Schema.optionalKey(Schema.String).pipe(Schema.catchDecoding(() => Effect.succeedNone))
})

console.log(String(Schema.decodeUnknownExit(schema)({ a: null })))
// Success({})
```

### Using a Service to provide a fallback value

You can use `Schema.catchDecodingWithContext` to get a fallback value from a service.

**Example** (Retrieving a fallback value from a service)

```ts
import { Context, Effect, Option, Schema } from "effect"

// Define a service that provides a fallback value
class Service extends Context.Service<Service, { fallback: Effect.Effect<string> }>()("Service") {}

//      ┌─── Codec<string, string, Service, never>
//      ▼
const schema = Schema.revealCodec(
  Schema.revealCodec(
    Schema.String.pipe(
      Schema.catchDecodingWithContext(() =>
        Effect.gen(function*() {
          const service = yield* Service
          return Option.some(yield* service.fallback)
        })
      )
    )
  )
)

// Provide the service during decoding
//      ┌─── Codec<string, string, never, never>
//      ▼
const provided = Schema.revealCodec(
  schema.pipe(Schema.middlewareDecoding(Effect.provideService(Service, { fallback: Effect.succeed("b") })))
)

console.log(String(Schema.decodeUnknownExit(provided)(null)))
// Success("b")
```
