<!--
Vendored from the Effect canonical Schema guide (Effect-TS/effect, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect v4 beta in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect/blob/main/packages/effect/SCHEMA.md

API surface audited against effect@4.0.0-beta.107: the formatters, `makeFormatterDefault`,
`makeFormatterStandardSchemaV1`, `hasInput`, `LeafHook`/`CheckHook` and `StandardSchemaV1FailureResult`
all exist as described; the two examples that fail to typecheck do so only on external/doc-local
imports (i18next, ./utils.js). FALSIFIED and corrected inline: `cause.failures` (a `Cause` exposes
`reasons`) and the `, got X` suffixes in expected output. RESTORED: the "Reporting Rejected Inputs"
section, which is what explains those suffixes — they appear only under `{ reportInput: true }`.
PROBED on beta.107: the corrected `cause.reasons` snippet compiles and prints exactly the expected
output shown, and the default formatter emits no input suffix.
-->

# Error Handling and Formatting

When validation fails, Schema produces structured error objects that describe what went wrong. Formatters turn those error objects into human-readable messages you can display to users or write to logs.

### Reporting Rejected Inputs

By default, schema issues neither retain rejected input values nor include them in formatted messages. Pass `{ reportInput: true }` to a parser when the additional diagnostic context is worth the disclosure and retention risk:

```ts
import { Result, Schema, SchemaIssue, SchemaParser } from "effect"

const result = SchemaParser.decodeUnknownResult(Schema.String)(1, { reportInput: true })
const formatIssue = SchemaIssue.makeFormatterDefault()

if (Result.isFailure(result)) {
  SchemaIssue.hasInput(result.failure) // true
  if (SchemaIssue.hasInput(result.failure)) {
    result.failure.input // 1
  }
  formatIssue(result.failure) // "Expected string, got 1"
}
```

> **Beta trap — the `, got X` suffix.** This is the single most common wrong
> expectation in this guide. Formatted messages carry **no** `, got <value>`
> suffix unless you opted into `reportInput`. Probed on `4.0.0-beta.107`:
> `Schema.decodeUnknownExit(Schema.NonEmptyString)("")` renders
> `Failure(Cause([Fail(SchemaError(Expected a value with a length of at least 1))]))`,
> and only with `{ reportInput: true }` does it become
> `... at least 1, got ""`. Earlier drafts of these reference files pasted the
> `reportInput` spellings into every default-mode example; a test asserting on
> them fails. Note also that the rendered prefix is `SchemaError(...)`, never
> `SchemaError: ...`.
>
> `SchemaParser.decodeUnknownResult` fails with a bare `SchemaIssue.Issue`, so
> `result.failure` **is** the issue. The `Schema.decodeUnknownResult` twin wraps
> it in a `SchemaError`, where you want `result.failure.issue` instead.

Value-bearing issues created by the parser then expose an enumerable own `input` field. The input is retained by reference, not copied. Use `SchemaIssue.hasInput(issue)` instead of checking `issue.input !== undefined`, because a present input whose value is `undefined` is distinct from an issue that does not retain input.

Enabling this option can retain or disclose secrets, personally identifiable information, and large object graphs. Object enumeration, spread, serialization, `SchemaIssue.makeFormatterDefault()`, `SchemaError.message`, and Standard Schema messages may expose the retained value. A Standard Schema failure still contains only its standard `message` and `path` fields; the input can appear inside `message`, but no non-standard `input` field is added.

User-created `SchemaIssue.Issue` values returned directly by declarations, checks, transformations, or middleware are not modified. To make a custom value-bearing issue honor `reportInput`, pass the callback's input and effective parse options to its constructor, for example `new SchemaIssue.InvalidValue(annotations, input, options)`.

### Formatters

#### StandardSchemaV1 formatter

The StandardSchemaV1 formatter is used by `Schema.toStandardSchemaV1` and will return a `StandardSchemaV1.FailureResult` object:

```ts
export interface FailureResult {
  /** The issues of failed validation. */
  readonly issues: ReadonlyArray<Issue>
}

export interface Issue {
  /** The error message of the issue. */
  readonly message: string
  /** The path of the issue. */
  readonly path: ReadonlyArray<PropertyKey>
}
```

You can customize the messages of the `Issue` object in two main ways:

- By passing formatter hooks
- By annotating schemas with `message` or `messageMissingKey` or `messageUnexpectedKey`

For the exact rule used by the default formatter for identifiers, filter
`expected`, and `message` annotations, see
[Filter error messages and schema identifiers](#filter-error-messages-and-schema-identifiers).

##### Hooks

Formatter hooks let you define custom messages in one place and apply them across different schemas. This can help avoid repeating message definitions and makes it easier to update them later.

Hooks are **required**. There is a default implementation that can be overridden only for demo purposes. This design helps keep the bundle size smaller by avoiding unused message formatting logic.

There are two kinds of hooks:

- `LeafHook` — for issues that occur at leaf nodes in the schema.
- `CheckHook` — for custom validation checks.

`LeafHook` handles these issue types:

- `InvalidType`
- `InvalidValue`
- `MissingKey`
- `UnexpectedKey`
- `Forbidden`
- `OneOf`

`CheckHook` handles `Check` issues, such as failed filters / refinements.

**Example** (Default hooks)

Default hooks are just for demo purposes:

- LeafHook: returns the issue tag
- CheckHook: returns the meta infos of the check as a string

```ts
import { Effect, Schema, SchemaIssue } from "effect"

const schema = Schema.Struct({
  a: Schema.NonEmptyString,
  b: Schema.NonEmptyString
})

Schema.decodeUnknownEffect(schema)({ b: "" }, { errors: "all" })
  .pipe(
    Effect.mapError((error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue)),
    Effect.runPromise
  )
  .then(console.log, (a) => console.dir(a, { depth: null }))
/*
Output:
{
  issues: [
    { path: [ 'a' ], message: 'Missing key' },
    { path: [ 'b' ], message: 'Expected a value with a length of at least 1' }
  ]
}
*/
```

##### Customizing messages

If a schema has a `message` annotation, it will take precedence over any formatter hook.

To make the examples easier to follow, we define a helper function that prints formatted validation messages using `SchemaFormatter`.

**Example utilities**

```ts
// utils.ts
import { Exit, Schema, SchemaIssue } from "effect"
import i18next from "i18next"

i18next.init({
  lng: "en",
  resources: {
    en: {
      translation: {
        "string.mismatch": "Please enter a valid string",
        "string.minLength": "Please enter at least {{minLength}} character(s)",
        "struct.missingKey": "This field is required",
        "struct.mismatch": "Please enter a valid object",
        "default.mismatch": "Invalid type",
        "default.invalidValue": "Invalid value",
        "default.forbidden": "Forbidden operation",
        "default.oneOf": "Too many successful values",
        "default.check": "The value does not match the check"
      }
    }
  }
})

export const t = i18next.t

export function getLogIssues(options?: {
  readonly leafHook?: SchemaIssue.LeafHook | undefined
  readonly checkHook?: SchemaIssue.CheckHook | undefined
}) {
  return <S extends Schema.Codec<unknown, unknown, never, never>>(schema: S, input: unknown) => {
    console.log(
      String(
        Schema.decodeUnknownExit(schema)(input, { errors: "all" }).pipe(
          Exit.mapError((err) => SchemaIssue.makeFormatterStandardSchemaV1(options)(err.issue).issues)
        )
      )
    )
  }
}
```

**Example** (Using hooks to translate common messages)

```ts
import { Schema } from "effect"
import { getLogIssues, t } from "./utils.js"

const Person = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty())
})

// Configure hooks to customize how issues are rendered
const logIssues = getLogIssues({
  // Format leaf-level issues (missing key, wrong type, etc.)
  leafHook: (issue) => {
    switch (issue._tag) {
      case "InvalidType": {
        if (issue.ast._tag === "String") {
          return t("string.mismatch") // Wrong type for a string
        } else if (issue.ast._tag === "Objects") {
          return t("struct.mismatch") // Value is not an object
        }
        return t("default.mismatch") // Fallback for other types
      }
      case "InvalidValue": {
        return t("default.invalidValue")
      }
      case "MissingKey":
        return t("struct.missingKey")
      case "UnexpectedKey":
        return t("struct.unexpectedKey")
      case "Forbidden":
        return t("default.forbidden")
      case "OneOf":
        return t("default.oneOf")
    }
  },
  // Format custom check errors (like isMinLength or user-defined validations)
  checkHook: (issue) => {
    const meta = issue.filter.annotations?.meta
    if (meta) {
      switch (meta._tag) {
        case "isMinLength": {
          return t("string.minLength", { minLength: meta.minLength })
        }
      }
    }
    return t("default.check")
  }
})

// Invalid object (not even a struct)
logIssues(Person, null)
// Failure(Cause([Fail([{"path":[],"message":"Please enter a valid object"}])]))

// Missing "name" key
logIssues(Person, {})
// Failure(Cause([Fail([{"path":["name"],"message":"This field is required"}])]))

// "name" has the wrong type
logIssues(Person, { name: 1 })
// Failure(Cause([Fail([{"path":["name"],"message":"Please enter a valid string"}])]))

// "name" is an empty string
logIssues(Person, { name: "" })
// Failure(Cause([Fail([{"path":["name"],"message":"Please enter at least 1 character(s)"}])]))
```

##### Inline custom messages

You can attach custom error messages directly to a schema using annotations. These messages can either be plain strings or functions that return strings. This is useful when you want to provide field-specific wording or localization without relying on formatter hooks.

**Example** (Attaching custom messages to a struct field)

```ts
import { Schema } from "effect"
import { getLogIssues, t } from "./utils.js"

const Person = Schema.Struct({
  name: Schema.String
    // Message for invalid type (e.g., number instead of string)
    .annotate({ message: t("string.mismatch") })
    // Message to show when the key is missing
    .annotateKey({ messageMissingKey: t("struct.missingKey") })
    // Message to show when the string is empty
    .check(Schema.isNonEmpty({ message: t("string.minLength", { minLength: 1 }) }))
})
  // Message to show when the whole object has the wrong shape
  .annotate({ message: t("struct.mismatch") })

// Use defaults for leaf and check hooks
const logIssues = getLogIssues()

// Invalid object (not even a struct)
logIssues(Person, null)
// Failure(Cause([Fail([{"path":[],"message":"Please enter a valid object"}])]))

// Missing "name" key
logIssues(Person, {})
// Failure(Cause([Fail([{"path":["name"],"message":"This field is required"}])]))

// "name" has the wrong type
logIssues(Person, { name: 1 })
// Failure(Cause([Fail([{"path":["name"],"message":"Please enter a valid string"}])]))

// "name" is an empty string
logIssues(Person, { name: "" })
// Failure(Cause([Fail([{"path":["name"],"message":"Please enter at least 1 character(s)"}])]))
```

##### Sending a FailureResult over the wire

You can use the `Schema.StandardSchemaV1FailureResult` schema to send a `StandardSchemaV1.FailureResult` over the wire.

**Example** (Sending a FailureResult over the wire)

```ts
import { Schema, SchemaIssue, SchemaParser } from "effect"

const b = Symbol.for("b")

const schema = Schema.Struct({
  a: Schema.NonEmptyString,
  [b]: Schema.Finite,
  c: Schema.Tuple([Schema.String])
})

// A Cause exposes `reasons`, not `failures`.
const r = SchemaParser.decodeUnknownExit(schema)({ a: "", c: [] }, { errors: "all" })

if (r._tag === "Failure") {
  const reasons = r.cause.reasons
  if (reasons[0]?._tag === "Fail") {
    const failureResult = SchemaIssue.makeFormatterStandardSchemaV1()(reasons[0].error)
    const serializer = Schema.toCodecJson(Schema.StandardSchemaV1FailureResult)
    console.dir(Schema.encodeSync(serializer)(failureResult), { depth: null })
  }
}
/*
{
  issues: [
    {
      message: 'Expected a value with a length of at least 1',
      path: [ 'a' ]
    },
    { message: 'Missing key', path: [ 'c', 0 ] },
    { message: 'Missing key', path: [ 'Symbol(b)' ] }
  ]
}
*/
```
