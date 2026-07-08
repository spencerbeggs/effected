<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Integrations

Schema integrates with popular frameworks and libraries. This section shows working examples for forms (TanStack Form) and web servers (Elysia).

### Forms

#### TanStack Form

Features:

- Errors are formatted with the `StandardSchemaV1` formatter.
- Fields are validated **and parsed** (not just strings).
- You can add form-level validation by attaching filters to the struct.
- Schemas may include async transformations.

**Example** (Parse user input and surface form-level errors)

```tsx
import { useForm } from "@tanstack/react-form"
import type { AnyFieldApi } from "@tanstack/react-form"
import { Effect, Schema, SchemaGetter, SchemaTransformation } from "effect"
import React from "react"

// ----------------------------------------------------
// Toolkit
// ----------------------------------------------------

// Treat an empty string from the UI as `undefined` for optional fields,
// and encode `undefined` back to an empty string when showing it.
const UndefinedFromEmptyString = Schema.Undefined.pipe(
  Schema.encodeTo(Schema.Literal(""), {
    decode: SchemaGetter.transform(() => undefined),
    encode: SchemaGetter.transform(() => "" as const)
  })
)

// Helper to make any schema "UI-optional":
// - empty string -> undefined
// - otherwise validate/parse with the given schema
function optional<S extends Schema.Top>(schema: S) {
  return Schema.Union([UndefinedFromEmptyString, schema])
}

// Decode helper that returns a `Promise<Result>` with either a typed value
// or a human-friendly error message string.
function decode<T, E>(schema: Schema.Codec<T, E>) {
  return function(value: unknown) {
    return Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((error) => error.message),
      Effect.result,
      Effect.runPromise
    )
  }
}

// ----------------------------------------------------
// Schemas
// ----------------------------------------------------

const FirstName = Schema.String.check(
  Schema.isMinLength(3, {
    message: "must be at least 3 characters"
  })
)
const Age = Schema.Number.check(
  Schema.isInt({ message: "must be an integer" }).abort(),
  Schema.isBetween(
    { minimum: 18, maximum: 100 },
    {
      message: "must be between 18 and 100"
    }
  )
).pipe(Schema.encodeTo(Schema.String, SchemaTransformation.numberFromString))

// Whole-form schema with a form-level rule:
// If firstName is "John", age is required.
const schema = Schema.Struct({
  firstName: FirstName,
  age: optional(Age)
}).check(
  Schema.makeFilter(({ firstName, age }) => {
    if (firstName === "John" && age === undefined) return "Age is required for John"
  })
)

function FieldInfo({ field }: { field: AnyFieldApi }) {
  return (
    <>
      {field.state.meta.isTouched && !field.state.meta.isValid ?
        <em>{field.state.meta.errors.map((error) => error.message).join(", ")}</em> :
        null}
      {field.state.meta.isValidating ? "Validating..." : null}
    </>
  )
}

export default function App() {
  // We parse the whole form on submit and keep the typed value here
  const parsedRef = React.useRef<undefined | typeof schema.Type>(undefined)

  const form = useForm({
    defaultValues: {
      firstName: "John",
      age: ""
    } satisfies (typeof schema)["Encoded"],
    validators: {
      onChangeAsync: Schema.toStandardSchemaV1(schema),

      // Final guard before submit:
      // - decode the entire form
      // - on failure: return a string (form-level error)
      // - on success: stash the typed value for `onSubmit`
      onSubmitAsync: async ({ value }) => {
        const r = await decode(schema)(value)
        if (r._tag === "Failure") return r.failure
        parsedRef.current = r.success
      }
    },

    // Submit runs only if validators pass.
    // At this point `parsedRef.current` holds the fully typed value.
    onSubmit: async () => {
      // get the parsed value from the ref
      const parsed = parsedRef.current
      if (!parsed) throw new Error("Unexpected submit without parsed data")
      // Use the typed data here (no post-processing needed)
      console.log(parsed)
    }
  })

  return (
    <div>
      <h1>Simple Form Example</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          form.handleSubmit()
        }}
      >
        <div>
          <form.Field name="firstName">
            {(field) => {
              return (
                <>
                  <label htmlFor={field.name}>First Name:</label>
                  <input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldInfo field={field} />
                </>
              )
            }}
          </form.Field>
        </div>

        <div>
          <form.Field name="age">
            {(field) => {
              return (
                <>
                  <label htmlFor={field.name}>Age:</label>
                  <input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldInfo field={field} />
                </>
              )
            }}
          </form.Field>
        </div>

        <form.Subscribe selector={(s) => [s.errorMap]}>
          {([errorMap]) =>
            errorMap.onSubmit ?
              (
                <div role="alert" style={{ marginTop: 12 }}>
                  <em>{String(errorMap.onSubmit)}</em>
                </div>
              ) :
              null}
        </form.Subscribe>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "..." : "Submit"}
            </button>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}
```

### Integrations

#### Elysia

```ts
import { node } from "@elysiajs/node"
import { openapi } from "@elysiajs/openapi"
import { Schema } from "effect"
import { Elysia } from "elysia"

// ----------------------------------------------------
// Utilities
// ----------------------------------------------------

function encodingJsonSchema<T, E, RD>(schema: Schema.Codec<T, E, RD, never>) {
  return Schema.toStandardSchemaV1(
    Schema.flip(Schema.toCodecJson(schema)).annotate({
      direction: "encoding"
    })
  )
}

function decodingJsonSchema<T, E, RE>(schema: Schema.Codec<T, E, never, RE>) {
  return Schema.toStandardSchemaV1(Schema.toCodecJson(schema))
}

function decodingStringSchema<T, E, RE>(schema: Schema.Codec<T, E, never, RE>) {
  return Schema.toStandardSchemaV1(Schema.toCodecStringTree(schema))
}

function mapJsonSchema(schema: Schema.Top) {
  return Schema.toJsonSchema(schema.ast.annotations?.direction === "encoding" ? Schema.flip(schema) : schema, {
    target: "draft-2020-12", // or "draft-07"
    referenceStrategy: "skip"
  }).schema
}

// ----------------------------------------------------
// Application
// ----------------------------------------------------

new Elysia({ adapter: node() })
  .use(
    openapi({
      mapJsonSchema: {
        effect: mapJsonSchema
      }
    })
  )
  .get(
    "/id/:id",
    async ({ status, params, query }) => {
      console.log(`params: ${JSON.stringify(params)}`)
      console.log(`query: ${JSON.stringify(query)}`)
      return status(200, { date: new Date() })
    },
    {
      params: decodingStringSchema(
        Schema.Struct({
          id: Schema.Int
        })
      ),
      query: decodingStringSchema(
        Schema.Struct({
          required: Schema.String,
          optional: Schema.optionalKey(Schema.String),
          array: Schema.Array(Schema.String),
          tuple: Schema.Tuple([Schema.String, Schema.Int])
        })
      ),
      response: {
        200: encodingJsonSchema(
          Schema.Struct({
            date: Schema.ValidDate
          })
        )
      }
    }
  )
  .post(
    "/body",
    ({ body }) => {
      console.log(body)
      return { bigint: body.bigint + 1n }
    },
    {
      body: decodingJsonSchema(
        Schema.Struct({
          bigint: Schema.BigInt
        })
      ),
      response: {
        200: encodingJsonSchema(
          Schema.Struct({
            bigint: Schema.BigInt
          })
        )
      }
    }
  )
  .listen(3000)
```
