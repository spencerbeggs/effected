<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Flipping Schemas

Flipping a schema swaps its decoding and encoding directions. If a schema decodes a `string` into a `number`, the flipped version decodes a `number` into a `string`. This is useful when you want to reuse an existing schema but invert its direction.

**Example** (Flipping a schema that parses a string into a number)

```ts
import { Schema } from "effect"

// Flips a schema that decodes a string into a number,
// turning it into one that decodes a number into a string
//
//      ┌─── flip<FiniteFromString>
//      ▼
const StringFromFinite = Schema.flip(Schema.FiniteFromString)
```

You can access the original schema using the `.schema` property:

**Example** (Accessing the original schema)

```ts
import { Schema } from "effect"

const StringFromFinite = Schema.flip(Schema.FiniteFromString)

//                 ┌─── FiniteFromString
//                 ▼
StringFromFinite.schema
```

Flipping a schema twice returns a schema with the same structure and behavior as the original:

**Example** (Double flipping restores the original schema)

```ts
import { Schema } from "effect"

//      ┌─── FiniteFromString
//      ▼
const schema = Schema.flip(Schema.flip(Schema.FiniteFromString))
```

## How it works

All internal operations in the Schema AST are symmetrical. Encoding with a schema is equivalent to decoding with its flipped version:

```ts
// Encoding with a schema is the same as decoding with its flipped version
encode(schema) = decode(flip(schema))
```

This symmetry ensures that flipping works consistently across all schema types.

## Flipped constructors

A flipped schema also includes a constructor. It builds values of the **encoded** type from the original schema.

**Example** (Using a flipped schema to construct an encoded value)

```ts
import { Schema } from "effect"

const schema = Schema.Struct({
  a: Schema.FiniteFromString
})

/*
type Encoded = {
    readonly a: string;
}
*/
type Encoded = (typeof schema)["Encoded"]

// make: { readonly a: string }  ──▶  { readonly a: string }
Schema.flip(schema).make
```
