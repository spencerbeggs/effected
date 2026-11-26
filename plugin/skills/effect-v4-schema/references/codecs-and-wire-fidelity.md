# Codecs and wire fidelity — `transformEffect`, encode-lossy unions and provenance

## `transformEffect`'s callback contract

Both callbacks must return an **`Effect`** — not a `Result`, not a bare value —
failing with a `SchemaIssue`. The vendored signature
(`SchemaTransformation.ts:390`):

```ts
export function transformEffect<T, E, RD = never, RE = never>(options: {
  readonly decode: (e: E, options: SchemaAST.ParseOptions) => Effect.Effect<T, SchemaIssue.Issue, RD>
  readonly encode: (t: T, options: SchemaAST.ParseOptions) => Effect.Effect<E, SchemaIssue.Issue, RE>
}): Transformation<T, E, RD, RE>
```

The house failure shape is `InvalidValue` carrying a message annotation, with
the offending value as the second argument:

```ts
Schema.String.pipe(Schema.decodeTo(Schema.Date,
  SchemaTransformation.transformEffect({
    decode: (s) => {
      const d = new Date(s);
      return isNaN(d.getTime())
        ? Effect.fail(new SchemaIssue.InvalidValue({ message: "Invalid date" }, s))
        : Effect.succeed(d);
    },
    encode: (d) => Effect.succeed(d.toISOString()),
  })))
```

Signature trap: `SchemaIssue.InvalidValue`'s constructor is
`(annotations?, input?, options?)` (`SchemaIssue.ts:768`), not
`(Option.some(s), { message })` — a plain annotations object is the first
argument, with no `Option` wrapper. The input is retained on the issue only
when parse options set `reportInput: true` (`SchemaIssue.ts:172-173`);
`InvalidType`'s constructor is `(ast, input?, options?)`
(`SchemaIssue.ts:687`). If your transformation is infallible, use
`SchemaTransformation.transform` (plain values, no Effect) instead; reach for
`transformEffect` only when it can fail.

## A homogeneous-Type union is encode-lossy: keep the Type heterogeneous when the wire form must survive

`Schema.Union([A, A.FromString])` — the reflex for "accept either the object
or its string shorthand" — **cannot round-trip the input encoding** when both
members decode to the *same* Type. On encode the union collapses to the
**first** member that produces that Type, regardless of which branch decoded
the value. A value parsed from the string form re-encodes as the object form,
silently: a string-form `author` in a `package.json` comes back in object
form. That is why `@effected/package-json`'s `Person.FromValue` carries a
`wireForms` WeakMap plus a faithfulness check — the union cannot remember
which branch a value came from, so the code must.

Probed, with a control proving the object form round-trips:

```ts
const A = Schema.Struct({ name: Schema.String })            // Type {name}, Encoded {name}
const AFromString = Schema.String.pipe(Schema.decodeTo(A,   // Type {name}, Encoded string
  SchemaTransformation.transform({ decode: (s) => ({ name: s }), encode: (a) => a.name })))
const U = Schema.Union([A, AFromString])

const v = Schema.decodeUnknownSync(U)("alice")              // via AFromString → {name:"alice"}
Schema.encodeUnknownSync(U)(v)                              // → {name:"alice"} (OBJECT), not "alice"
// round-trips to the string form? false
```

The rule: **if two union members decode to the same Type, that union cannot
preserve which encoding an input used.** When wire-form fidelity matters, keep
the Type heterogeneous (a distinct `_tag` or shape per encoding), or remember
the original wire form out of band and replay it on encode as `Person` does.
A "class IS the schema" homogeneous union reads as symmetric and is not.

## Out-of-band provenance needs `Schema.instanceOf(C)` as the `decodeTo` target, not `C`

The remedy above — remember the wire form in a `WeakMap` keyed on the decoded
instance — is defeated by the obvious spelling of it. **`Schema.decodeTo(C, …)`
where `C` is a `Schema.Class` re-validates the transform's output and hands the
caller a DIFFERENT instance.** Every `WeakMap` the transform populated misses,
and the encode side silently takes its rebuild-from-fields fallback: no error,
no type complaint, just the fidelity the map existed to provide, gone.

`Schema.instanceOf(C)` as the target passes the instance through by reference.
That is why `@effected/package-json`'s `Person.schema`, `Person.FromString` and
`Person.FromValue` all target `Schema.instanceOf(Person)` — the class is what
the transform CONSTRUCTS, never what the codec decodes TO.

Probed:

```ts
class Item extends Schema.Class<Item>("Item")({ url: Schema.String }) {}
let produced: Item | undefined
const tx = SchemaTransformation.transform({
  decode: (s: string) => (produced = Item.make({ url: s })),
  encode: (a: Item) => a.url,
})

Schema.decodeUnknownSync(Schema.String.pipe(Schema.decodeTo(Item, tx)))("a") === produced
// false — reconstructed

Schema.decodeUnknownSync(Schema.String.pipe(Schema.decodeTo(Schema.instanceOf(Item), tx)))("b") === produced
// true — same reference, and still true nested in Schema.Array and Schema.Struct
```

**The target you switch to validates less.** `Schema.instanceOf(C)` is an
`instanceof` check and nothing more — it does not apply `C`'s field schemas or
its checks, so whatever the transform returns passes straight through. Moving
the target from `C` to `Schema.instanceOf(C)` to keep identity therefore also
removes the field validation the class target was performing, and the
transform has to carry it instead:

```ts
const invalid = Object.assign(Item.make({ url: "ok" }), { url: 1 })
Schema.decodeUnknownSync(Schema.instanceOf(Item))(invalid)  // accepted, url === 1
Schema.decodeUnknownSync(Item)(invalid)                     // rejected
```

Construct with `C.make` inside the transform, and validate any input the
constructor does not — `@effected/package-json`'s `Person.schema` decodes the
raw object through a separate `PersonFields` struct first, precisely so the
issue tree stays identical to what a direct class decode produced.

Two more riders:

- **Key the map on the element, never on a container.** `Schema.Array` rebuilds
  the array itself, so an array-keyed `WeakMap` is empty by the time `encode`
  runs even when every element's identity survived. When the provenance is a
  property of the collection (`@effected/package-json`'s `Funding` remembers
  whether an entry was written bare rather than inside an array), hang it on the
  one element that carried it and guard the replay on that element still being
  alone.
- **Guard every replay on the instance still matching.** `Schema.Class`
  instances are not frozen, so an instance edited in place keeps provenance that
  no longer describes it, and an unguarded replay writes the ORIGINAL wire back
  — discarding the edit. The guard must cover the fields the wire form cannot
  express, not only the ones it can: the shorthand-string branch of `Person`
  matched on `name`/`email`/`url`, replayed, and dropped any key added to `rest`
  afterwards.
