<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.93 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Classes and Opaque Types

Schema supports two kinds of nominal types: _opaque structs_ for lightweight distinct types, and _classes_ for full-featured types with methods and prototype-backed instances.

## Opaque Structs

Goal: opaque typing without changing runtime behavior.

`Schema.Opaque` lets you take an ordinary `Schema.Struct` and wrap it in a thin class shell whose **only** purpose is to create a distinct TypeScript type.

Internally the value is **still the same plain struct schema**.

Instance methods and custom constructors **are not allowed** in opaque structs (no `new ...`).
This is not enforced at the type level, but it may be enforced through a linter in the future.

### How is this different from `Schema.Class`?

`Schema.Class` also wraps a `Struct`, **but** it turns the wrapper into a proper class:

- You can add instance methods, getters, setters, custom constructors.
- Instances compare structurally with `Equal.equals`, but they do not implement `Equal`.
- Instances carry the class prototype at runtime, so `instanceof` checks succeed and methods are callable.

**Example** (Creating an Opaque Struct)

```ts
import { Schema } from "effect"

class Person extends Schema.Opaque<Person>()(
  Schema.Struct({
    name: Schema.String
  })
) {}

//      ┌─── Codec<Person, { readonly name: string; }, never, never>
//      ▼
const codec = Schema.revealCodec(Person)

// const person: Person
const person = Person.make({ name: "John" })

console.log(person.name)
// "John"

// The class itself holds the original schema and its metadata
console.log(Person)
// -> [Function: Person] Struct$

// { readonly name: Schema.String }
Person.fields

/*
const another: Schema.Struct<{
    readonly name: typeof Person;
}>
*/
const another = Schema.Struct({ name: Person }) // You can use the opaque type inside other schemas

/*
type Type = {
    readonly name: Person;
}
*/
type Type = (typeof another)["Type"]
```

Opaque structs can be used just like regular structs, with no other changes needed.

**Example** (Retrieving Schema Fields)

```ts
import { Schema } from "effect"

// A function that takes a generic struct
const getFields = <Fields extends Schema.Struct.Fields>(struct: Schema.Struct<Fields>) => struct.fields

class Person extends Schema.Opaque<Person>()(
  Schema.Struct({
    name: Schema.String
  })
) {}

/*
const fields: {
    readonly name: Schema.String;
}
*/
const fields = getFields(Person)
```

### Static methods

You can add static members to an opaque struct class to extend its behavior.

**Example** (Custom serializer via static method)

```ts
import { Schema } from "effect"

class Person extends Schema.Opaque<Person>()(
  Schema.Struct({
    name: Schema.String,
    createdAt: Schema.Date
  })
) {
  // Create a custom serializer using the class itself
  static readonly serializer = Schema.toCodecJson(this)
}

console.log(
  Schema.encodeUnknownSync(Person)({
    name: "John",
    createdAt: new Date()
  })
)
// { name: 'John', createdAt: 2025-05-02T13:49:29.926Z }

console.log(
  Schema.encodeUnknownSync(Person.serializer)({
    name: "John",
    createdAt: new Date()
  })
)
// { name: 'John', createdAt: '2025-05-02T13:49:29.928Z' }
```

### Annotations and filters

You can attach filters and annotations to the struct passed into `Opaque`.

**Example** (Applying a filter and title annotation)

```ts
import { Schema } from "effect"

class Person extends Schema.Opaque<Person>()(
  Schema.Struct({
    name: Schema.String
  }).annotate({ identifier: "Person" })
) {}

console.log(String(Schema.decodeUnknownExit(Person)(null)))
// Failure(Cause([Fail(SchemaError: Expected Person, got null)]))
```

When you call methods like `annotate` on an opaque struct, you get back the original struct, not a new class.

```ts
import { Schema } from "effect"

class Person extends Schema.Opaque<Person>()(
  Schema.Struct({
    name: Schema.String
  })
) {}

/*
const S: Schema.Struct<{
    readonly name: Schema.String;
}>
*/
const S = Person.annotate({ title: "Person" }) // `annotate` returns the wrapped struct type
```

### Recursive Opaque Structs

**Example** (Recursive Opaque Struct with Same Encoded and Type)

```ts
import { Schema } from "effect"

export class Category extends Schema.Opaque<Category>()(
  Schema.Struct({
    name: Schema.String,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => Category))
  })
) {}

/*
type Encoded = {
    readonly children: readonly Category[];
    readonly name: string;
}
*/
export type Encoded = (typeof Category)["Encoded"]
```

**Example** (Recursive Opaque Struct with Different Encoded and Type)

```ts
import { Schema } from "effect"

interface CategoryEncoded extends Schema.Codec.Encoded<typeof Category> {}

export class Category extends Schema.Opaque<Category>()(
  Schema.Struct({
    name: Schema.FiniteFromString,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Category, CategoryEncoded> => Category))
  })
) {}

/*
type Encoded = {
    readonly children: readonly CategoryEncoded[];
    readonly name: string;
}
*/
export type Encoded = (typeof Category)["Encoded"]
```

**Example** (Mutually Recursive Schemas)

```ts
import { Schema } from "effect"

class Expression extends Schema.Opaque<Expression>()(
  Schema.Struct({
    type: Schema.Literal("expression"),
    value: Schema.Union([Schema.Number, Schema.suspend((): Schema.Codec<Operation> => Operation)])
  })
) {}

class Operation extends Schema.Opaque<Operation>()(
  Schema.Struct({
    type: Schema.Literal("operation"),
    operator: Schema.Literals(["+", "-"]),
    left: Expression,
    right: Expression
  })
) {}

/*
type Encoded = {
    readonly type: "operation";
    readonly operator: "+" | "-";
    readonly left: {
        readonly type: "expression";
        readonly value: number | Operation;
    };
    readonly right: {
        readonly type: "expression";
        readonly value: number | Operation;
    };
}
*/
export type Encoded = (typeof Operation)["Encoded"]
```

### Branded Opaque Structs

You can brand an opaque struct using the `Brand` generic parameter.

**Example** (Branded Opaque Struct)

```ts
import { Schema } from "effect"

class A extends Schema.Opaque<A, { readonly brand: unique symbol }>()(
  Schema.Struct({
    a: Schema.String
  })
) {}
class B extends Schema.Opaque<B, { readonly brand: unique symbol }>()(
  Schema.Struct({
    a: Schema.String
  })
) {}

const f = (a: A) => a
const g = (b: B) => b

f(A.make({ a: "a" })) // ok
g(B.make({ a: "a" })) // ok

f(B.make({ a: "a" })) // error: Argument of type 'B' is not assignable to parameter of type 'A'.
g(A.make({ a: "a" })) // error: Argument of type 'A' is not assignable to parameter of type 'B'.
```

Like with branded classes, you can use the `Brand` module to create branded opaque structs.

```ts
import { Schema } from "effect"
import type { Brand } from "effect"

class A extends Schema.Opaque<A, Brand.Brand<"A">>()(
  Schema.Struct({
    a: Schema.String
  })
) {}
class B extends Schema.Opaque<B, Brand.Brand<"B">>()(
  Schema.Struct({
    a: Schema.String
  })
) {}

const f = (a: A) => a
const g = (b: B) => b

f(A.make({ a: "a" })) // ok
g(B.make({ a: "a" })) // ok

f(B.make({ a: "a" })) // error: Argument of type 'B' is not assignable to parameter of type 'A'.
g(A.make({ a: "a" })) // error: Argument of type 'A' is not assignable to parameter of type 'B'.
```

## Schema as a Class

`Schema.asClass` turns any schema into a class that can be extended with `extends`. The resulting class inherits the full schema API (e.g. `annotate`) and supports static methods that reference `this`.

Unlike `Schema.Opaque`, it does **not** make the decoded type nominally distinct, and unlike `Schema.Class`, it does **not** create prototype-backed instances with methods or constructors. It is a lightweight way to attach custom static helpers to a schema.

### Wrapping a Primitive Schema

```ts
import { Schema } from "effect"

class MyString extends Schema.asClass(Schema.String) {
  static readonly decodeUnknownSync = Schema.decodeUnknownSync(this)
}

console.log(MyString.decodeUnknownSync("a"))
// "a"
```

### Wrapping a Struct Schema

```ts
import { Schema } from "effect"

class MyStruct extends Schema.asClass(
  Schema.Struct({ name: Schema.String })
) {
  static readonly decodeUnknownSync = Schema.decodeUnknownSync(this)
}

console.log(MyStruct.decodeUnknownSync({ name: "a" }))
// { name: "a" }
```

### Subclassing

You can extend an `asClass` class to layer on more static helpers:

```ts
import { Schema } from "effect"

class MyString extends Schema.asClass(Schema.FiniteFromString) {
  static readonly decodeUnknownSync = Schema.decodeUnknownSync(this)
}

class MyString2 extends MyString {
  static readonly encodeSync = Schema.encodeSync(this)
}

console.log(MyString2.decodeUnknownSync("1"))
// 1
console.log(MyString2.encodeSync(1))
// "1"
```

## Classes

### Existing Classes

#### Validating the Constructor

**Use Case**: When you want to validate the constructor arguments of an existing class.

**Example** (Using a tuple to validate the constructor arguments)

```ts
import { Schema } from "effect"

const PersonConstructorArguments = Schema.Tuple([Schema.String, Schema.Finite])

// Existing class
class Person {
  constructor(readonly name: string, readonly age: number) {
    PersonConstructorArguments.make([name, age])
  }
}

try {
  new Person("John", NaN)
} catch (error) {
  if (error instanceof Error) {
    console.log(error.message)
  }
}
/*
Expected a finite number, got NaN
  at [1]
*/
```

**Example** (Inheritance)

```ts
import { Schema } from "effect"

const PersonConstructorArguments = Schema.Tuple([Schema.String, Schema.Finite])

class Person {
  constructor(readonly name: string, readonly age: number) {
    PersonConstructorArguments.make([name, age])
  }
}

const PersonWithEmailConstructorArguments = Schema.Tuple([Schema.String])

class PersonWithEmail extends Person {
  constructor(name: string, age: number, readonly email: string) {
    // Only validate the additional argument
    PersonWithEmailConstructorArguments.make([email])
    super(name, age)
  }
}
```

#### Defining a Schema

```ts
import { Schema, SchemaTransformation } from "effect"

class Person {
  constructor(readonly name: string, readonly age: number) {}
}

const PersonSchema = Schema.instanceOf(Person, {
  title: "Person",
  // optional: default JSON serialization
  toCodecJson: () =>
    Schema.link<Person>()(
      Schema.Tuple([Schema.String, Schema.Number]),
      SchemaTransformation.transform({
        decode: (args) => new Person(...args),
        encode: (instance) => [instance.name, instance.age] as const
      })
    )
})
  // optional: explicit encoding
  .pipe(
    Schema.encodeTo(
      Schema.Struct({
        name: Schema.String,
        age: Schema.Number
      }),
      SchemaTransformation.transform({
        decode: (args) => new Person(args.name, args.age),
        encode: (instance) => instance
      })
    )
  )
```

**Example** (Inheritance)

```ts
import { Schema, SchemaTransformation } from "effect"

class Person {
  constructor(readonly name: string, readonly age: number) {}
}

const PersonSchema = Schema.instanceOf(Person, {
  title: "Person",
  // optional: default JSON serialization
  toCodecJson: () =>
    Schema.link<Person>()(
      Schema.Tuple([Schema.String, Schema.Number]),
      SchemaTransformation.transform({
        decode: (args) => new Person(...args),
        encode: (instance) => [instance.name, instance.age] as const
      })
    )
})
  // optional: explicit encoding
  .pipe(
    Schema.encodeTo(
      Schema.Struct({
        name: Schema.String,
        age: Schema.Number
      }),
      SchemaTransformation.transform({
        decode: (args) => new Person(args.name, args.age),
        encode: (instance) => instance
      })
    )
  )

class PersonWithEmail extends Person {
  constructor(name: string, age: number, readonly email: string) {
    super(name, age)
  }
}

// const PersonWithEmailSchema = ...repeat the pattern above...
```

#### Errors

**Example** (Extending Data.Error)

```ts
import { Data, Effect, identity, Schema, SchemaTransformation, SchemaUtils } from "effect"

const Props = Schema.Struct({
  message: Schema.String
})

class Err extends Data.Error<typeof Props.Type> {
  constructor(props: typeof Props.Type) {
    super(Props.make(props))
  }
}

const program = Effect.gen(function*() {
  yield* new Err({ message: "Uh oh" })
})

Effect.runPromiseExit(program).then((exit) => console.log(JSON.stringify(exit, null, 2)))
/*
{
  "_id": "Exit",
  "_tag": "Failure",
  "cause": {
    "_id": "Cause",
    "failures": [
      {
        "_tag": "Fail",
        "error": {
          "message": "Uh oh"
        }
      }
    ]
  }
}
*/

const transformation = SchemaTransformation.transform<Err, (typeof Props)["Type"]>({
  decode: (props) => new Err(props),
  encode: identity
})

const schema = Schema.instanceOf(Err, {
  title: "Err",
  serialization: {
    json: () => Schema.link<Err>()(Props, transformation)
  }
}).pipe(Schema.encodeTo(Props, transformation))

// built-in helper?
const builtIn = SchemaUtils.getNativeClassSchema(Err, { encoding: Props })
```

### Class API

**Example** (Constructing and decoding a class)

```ts
import { Schema } from "effect"

// Define a class with a single string field "a"
class A extends Schema.Class<A>("A")({
  a: Schema.String
}) {
  // Regular class fields are allowed
  readonly _a = 1
}

console.log(new A({ a: "a" }))
// A { a: 'a', _a: 1 }
console.log(A.make({ a: "a" }))
// A { a: 'a', _a: 1 }
console.log(Schema.decodeUnknownSync(A)({ a: "a" }))
// A { a: 'a', _a: 1 }
```

#### Filters

To attach a filter to the whole class, pass a `Struct` instead of a field record and call `.check(...)` on it.

**Example** (Validating a relationship between fields)

```ts
import { Schema } from "effect"

class A extends Schema.Class<A>("A")(
  Schema.Struct({
    a: Schema.String,
    b: Schema.String
  }).check(Schema.makeFilter(({ a, b }) => a === b, { title: "a === b" }))
) {}

try {
  new A({ a: "a", b: "b" })
} catch (error: any) {
  console.log(error.message)
}
// Expected a === b, got {"a":"a","b":"b"}

try {
  Schema.decodeUnknownSync(A)({ a: "a", b: "b" })
} catch (error: any) {
  console.log(error.message)
}
// Expected a === b, got {"a":"a","b":"b"}
```

#### Branded Classes

Attach a brand to a class to avoid mixing values from different domains that share the same structure.

**Example** (Unique brands block assignment)

```ts
import { Schema } from "effect"

// Brand the class using a unique symbol type parameter
class A extends Schema.Class<A, { readonly brand: unique symbol }>("A")({
  a: Schema.String
}) {}

class B extends Schema.Class<B, { readonly brand: unique symbol }>("B")({
  a: Schema.String
}) {}

// Even though A and B have the same fields, their brands are different,
// so they are not assignable to each other.

// @ts-expect-error
export const a: A = B.make({ a: "a" })
// @ts-expect-error
export const b: B = A.make({ a: "a" })
```

**Example** (Using the Brand module)

```ts
import type { Brand } from "effect"
import { Schema } from "effect"

class A extends Schema.Class<A, Brand.Brand<"A">>("A")({
  a: Schema.String
}) {}

class B extends Schema.Class<B, Brand.Brand<"B">>("B")({
  a: Schema.String
}) {}

// Different named brands are still not assignable

// @ts-expect-error
export const a: A = B.make({ a: "a" })
// @ts-expect-error
export const b: B = A.make({ a: "a" })
```

#### Annotations

Attach metadata to a class schema. The metadata is stored as annotations on the schema AST and can be read at runtime.

**Example** (Attaching and reading annotations)

```ts
import { Schema } from "effect"

export class A extends Schema.Class<A>("A")(
  {
    a: Schema.String
  },
  // Attach metadata (e.g., title) alongside the schema
  { title: "my title" }
) {}

console.log(A.ast.annotations?.title)
// "my title"
```

#### extend

Use `extend` to create a subclass that adds fields to the base schema. Instance fields declared on the base class are also available on the subclass.

**Example** (Extending a class with new fields)

```ts
import { Schema } from "effect"

// Base class with one schema field ("a") and one regular class field ("_a")
class A extends Schema.Class<A>("A")(
  Schema.Struct({
    a: Schema.String
  })
) {
  readonly _a = 1
}

// Subclass adds a new schema field ("b") and its own regular field ("_b")
class B extends A.extend<B>("B")({
  b: Schema.Number
}) {
  readonly _b = 2
}

console.log(new B({ a: "a", b: 2 }))
// B { a: 'a', _a: 1, _b: 2 }
console.log(B.make({ a: "a", b: 2 }))
// B { a: 'a', _a: 1, _b: 2 }
console.log(Schema.decodeUnknownSync(B)({ a: "a", b: 2 }))
// B { a: 'a', _a: 1, _b: 2 }
```

#### extends and static members

To keep static members from the base class, pass `typeof Base` as the second generic parameter when calling `extend`.

**Example** (Preserving static members on subclasses)

```ts
import { Schema } from "effect"

class A extends Schema.Class<A>("A")({
  a: Schema.String
}) {
  static readonly foo = "foo"
}

class B extends A.extend<B, typeof A>("B")({
  b: Schema.Number
}) {}

console.log(B.foo)
// "foo"
```

#### Recursive Classes

Use `Schema.suspend` to reference a class inside its own definition. This is common for tree-like data structures.

**Example** (Self-referential tree structure)

```ts
import { Schema } from "effect"

// A simple tree of categories where each node can have child categories.
// Use Schema.suspend to refer to Category while it is being defined.
export class Category extends Schema.Class<Category>("Category")(
  Schema.Struct({
    name: Schema.String,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => Category))
  })
) {}

/*
type Encoded = {
    readonly children: readonly Category[];
    readonly name: string;
}
*/
export type Encoded = (typeof Category)["Encoded"]
```

**Example** (Recursive schema with different Encoded and Type)

```ts
import { Schema } from "effect"

// Define the encoded representation for Category separately.
// This is useful when the Encoded type differs from the Type type.
interface CategoryEncoded extends Schema.Codec.Encoded<typeof Category> {}

// The runtime type is Category; the encoded form is CategoryEncoded.
// "name" is decoded from a string to a finite number to show that
// Type and Encoded types can differ.
export class Category extends Schema.Class<Category>("Category")(
  Schema.Struct({
    name: Schema.FiniteFromString,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Category, CategoryEncoded> => Category))
  })
) {}

/*
type Encoded = {
    readonly children: readonly CategoryEncoded[];
    readonly name: string;
}
*/
export type Encoded = (typeof Category)["Encoded"]
```

**Example** (Mutually recursive expression language)

```ts
import { Schema } from "effect"

class Expression extends Schema.Class<Expression>("Expression")(
  Schema.Struct({
    type: Schema.Literal("expression"),
    value: Schema.Union([Schema.Number, Schema.suspend((): Schema.Codec<Operation> => Operation)])
  })
) {}

class Operation extends Schema.Class<Operation>("Operation")(
  Schema.Struct({
    type: Schema.Literal("operation"),
    operator: Schema.Literals(["+", "-"]),
    left: Expression,
    right: Expression
  })
) {}

/*
type Encoded = {
    readonly type: "operation";
    readonly operator: "+" | "-";
    readonly left: {
        readonly type: "expression";
        readonly value: number | Operation;
    };
    readonly right: {
        readonly type: "expression";
        readonly value: number | Operation;
    };
}
*/
export type Encoded = (typeof Operation)["Encoded"]
```

### TaggedClass

`TaggedClass` is a convenience over `Class` that automatically adds a `_tag` field using `Schema.tag`. This is useful for discriminated unions where each variant needs a tag.

The tag value doubles as the identifier by default. Pass an explicit identifier as the first argument to override it.

**Example** (Basic tagged class)

```ts
import { Schema } from "effect"

class Person extends Schema.TaggedClass<Person>()("Person", {
  name: Schema.String
}) {}

const mike = new Person({ name: "Mike" })
console.log(mike)
// Person { _tag: 'Person', name: 'Mike' }
console.log(mike._tag)
// "Person"
```

**Example** (Custom identifier)

```ts
import { Schema } from "effect"

class Person extends Schema.TaggedClass<Person>("MyPerson")("Person", {
  name: Schema.String
}) {}

console.log(Person.identifier)
// "MyPerson"
console.log(new Person({ name: "Mike" })._tag)
// "Person"
```

**Example** (Discriminated union)

```ts
import { Schema } from "effect"

class Cat extends Schema.TaggedClass<Cat>()("Cat", {
  lives: Schema.Number
}) {}

class Dog extends Schema.TaggedClass<Dog>()("Dog", {
  wagsTail: Schema.Boolean
}) {}

const Animal = Schema.Union([Cat, Dog])

console.log(Schema.decodeUnknownSync(Animal)({ _tag: "Cat", lives: 9 }))
// Cat { _tag: 'Cat', lives: 9 }
```

All features from `Class` are available: `extend`, `annotate`, `check`, branded classes, and recursive definitions.

### ErrorClass

```ts
import { Schema } from "effect"

class E extends Schema.ErrorClass<E>("E")({
  id: Schema.Number
}) {}
```

### TaggedErrorClass

`TaggedErrorClass` combines `ErrorClass` with an automatic `_tag` field, giving you a tagged error that can be caught with `Effect.catchTag`.

Like `TaggedClass`, the tag value doubles as the identifier by default, and you can pass an explicit identifier as the first argument to override it.

**Example** (Defining and catching a tagged error)

```ts
import { Effect, Schema } from "effect"

class HttpError extends Schema.TaggedErrorClass<HttpError>()("HttpError", {
  status: Schema.Number,
  message: Schema.String
}) {}

const program = Effect.gen(function*() {
  yield* new HttpError({ status: 404, message: "Not found" })
})

const recovered = program.pipe(
  Effect.catchTag("HttpError", (err) => Effect.succeed(`Caught: ${err.status} ${err.message}`))
)
```

**Example** (Multiple tagged errors in a union)

```ts
import { Effect, Schema } from "effect"

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  path: Schema.String
}) {}

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("Unauthorized", {
  reason: Schema.String
}) {}

const program = Effect.gen(function*() {
  if (Math.random() < 0.5) {
    yield* new Unauthorized({ reason: "Unauthorized" })
  } else {
    yield* new NotFound({ path: "/missing" })
  }
})

// Each error can be caught independently by its tag
const recovered = program.pipe(
  Effect.catchTags({
    NotFound: (err) => Effect.succeed(`Not found: ${err.path}`),
    Unauthorized: (err) => Effect.succeed(`Unauthorized: ${err.reason}`)
  })
)
```

All features from `ErrorClass` are available: `extend`, `annotate`, and `check`.
