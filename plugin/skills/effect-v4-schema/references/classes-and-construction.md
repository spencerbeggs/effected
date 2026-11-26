# Class-factory patterns — statics, nested fields, equality, tags and defaults

## The reserved `make` collision: `parse` / `parseResult` is the house resolution

Every class factory reserves a static `make`, so a validating
`make(input: string)` is impossible — the signatures are incompatible and TS
rejects the whole static side:

```text
TS2417: Class static side 'typeof Version' incorrectly extends base class static side ...
  Types of property 'make' are incompatible.
    Type '(_raw: string) => Version' is not assignable to
      type '(input: ReadonlyMakeIn<{ readonly major: Number; }>, options?: MakeOptions) => Version'
```

There is no overload escape: `make` belongs to the base. The kit's answer,
used by the kit's `SemVer`, `Range`, `Comparator`, `Jsonc`, `Markdown`, `MarkdownDocument`
and `Lockfile`, is a **pair** — the sync `Result` primitive plus the `Effect`
form defined in terms of it:

```ts
export class SemVer extends Schema.Class<SemVer>("SemVer")({ /* fields */ }) {
  // sync, total, no Effect runtime needed — the primitive
  static parseResult(input: string): Result.Result<SemVer, InvalidVersionError> { /* ... */ }

  // the Effect form: a named span + the Result bridge, nothing more
  static readonly parse = Effect.fn("SemVer.parse")((input: string) =>
    Effect.fromResult(SemVer.parseResult(input)));
}
```

`make` stays what the factory made it — the validated field constructor —
while `parse`/`parseResult` own string input: the sync form serves a caller
with no Effect runtime, and the Effect form adds the span. The
`Effect.fromResult` bridge, and why `yield* someResult` does not work, are
owned by the `effect-v4-idioms` skill.

## A nested `Schema.Class` field: foreign and self-recursive behave identically

`make`'s treatment of a class-typed field does not split on whether the
field's schema refers to the class being defined: a *foreign* field and a
*self-recursive* field behave the same way in every case that matters.

| Field shape | plain-object literal | invalid plain literal | prototype-forged bad instance | passes a good instance through by reference |
| --- | --- | --- | --- | --- |
| **foreign** class — `inner: Inner`, `suspend(() => Inner)`, `Array(suspend(() => Inner))` | accepted, **promoted** to a real instance | **rejected**, with a path | **accepted** unexamined | **yes** — identity preserved |
| **self-recursive** — `suspend(() => Self)`, bare, `optionalKey`-wrapped or inside `Array` | accepted, **promoted** to a real instance | **rejected**, with a path (`at ["kid"]["v"]`) | **accepted** unexamined | **yes** — identity preserved |

What follows from the one row you are always in:

- **Hand either kind of field a literal.** It is deep-validated and promoted to
  a real instance (`instanceof` is true). Hand-built trees and fixtures do not
  need real instances at every level — constructing `Inner.make({...})` purely
  to satisfy a self-recursive field is unnecessary, though harmless.
- **Identity is preserved.** `Outer.make({ inner: x }).inner === x` is **true**
  for a foreign field as much as a self-recursive one — do not assume a
  foreign field is re-constructed and skip a `strictEqual` assertion on it.
  `deepStrictEqual` / `Equal.equals` remain the better assertion anyway,
  because they keep passing across a schema's own internal refactors.
- **A prototype-forged instance is still accepted unexamined**, in both rows —
  the `instanceof` check short-circuits the field's validation. Anything that
  forges instances to skip validation (`@effected/jsonc`'s `makeNodeUnsafe`)
  therefore owns its own correctness.
- **The TYPE level is a separate axis.** `make`'s input type for a class-typed
  field is the class's **instance type**, so a member-less value class is
  structurally satisfied by a literal and compiles, while a class carrying any
  member the literal lacks (a getter, a method — most real classes) rejects
  the literal at compile time (TS2741 / TS2740) even though runtime would
  validate and promote it. Do not read that error as "the check narrowed
  `make`" — wrapping the field in `.pipe(Schema.check(...))` changes nothing
  on this axis.
- **Construction is linear**: a recursive tree built node-by-node measures
  well under a millisecond at every depth from 10 to 60.

> **Not exponential.** Node-by-node construction of a recursive `Schema.Class`
> does not re-validate its whole subtree on every level — a left-spine build
> stays flat, sub-millisecond, from depth 10 through depth 60. A control that
> does genuinely exponential work (2^d) measures in the tens of milliseconds
> at the same depths, so a harness built to see exponential cost here would
> see it if it were real. Do **not** add a validation bypass for cost reasons.

## Class-factory equality is deep and structural — but instances are not frozen

`Equal.equals` on two class-factory instances recurses. It is not reference
equality, and it is not shallow: it walks **nested `Schema.Class` fields**,
`Schema.optionalKey` fields (a present key and an absent one compare **unequal**,
which is the discrimination `exactOptionalPropertyTypes` semantics need), and
`Schema.Array`-of-class fields element by element. **`Hash` agrees wherever
`Equal` agrees**, so these instances are safe as `HashMap`/`HashSet` keys with no
custom `[Hash.symbol]`.

The full matrix was probed 14/14 including discriminating controls — a
one-field difference at each nesting depth compared unequal, so the probe
could fail and did not. **Do not re-probe it**, and do not hand-write a
recursive comparator for a class tree: `Equal.equals` already is one. (It is
also what keeps assertions stable across the identity churn the nested-field
table documents.)

Two `Schema.Record` rows, probed with discriminating controls: a
plain `Schema.Record(String, String)` field compares structurally and
**order-insensitively** (same pairs in different insertion orders are equal; a
value-change control is unequal), and the `optionalKey` present-vs-absent rule
above applies to records too — a PRESENT `{}` and an ABSENT key compare
**unequal**. The design consequence: a field whose contract is "absent ≡
empty" must be always-present with a constructor default
(`Schema.Record(...).pipe(Schema.withConstructorDefault(Effect.succeed({})))`),
because the `optionalKey` shape makes an explicit-`{}` value drift forever
against an omitted one.

**But nothing is frozen.** A `Schema.Class` instance is a plain object at
runtime; `Schema.ts` calls `Object.freeze` nowhere. Validation happens at
construction and never again, so a mutated instance keeps **stale derived and
provenance state** — a cached hash, a `_tag`-adjacent invariant, the wire-form
bookkeeping a provenance-keeping codec relies on — while still satisfying its type.
Guard anything that **replays a value onto the wire, or caches keyed on instance
identity**: treat instances as immutable by discipline, and rebuild with
`make` rather than assigning a field, because the type system will not stop you.

## The `message` getter: ternary chain, not an exhaustive switch

Every `TaggedError` with a multi-reason `message` hits this. A `switch` over
a `Schema.Literals`-typed `reason` in which **every case returns** is exhaustive,
and tsgo is happy — but Biome's `lint/suspicious/useGetterReturn` sees a getter
with no terminal return and fails the lint gate:

> `× This getter should return a value.`

```text
// REJECTED by `pnpm lint` (useGetterReturn), accepted by tsgo:
get message(): string {
 switch (this.reason) {
  case "missing":  return `missing ${this.key}`;
  case "invalid":  return `invalid ${this.key}`;
  case "conflict": return `conflict on ${this.key}`;
 }
}

// The house pattern — one return, a ternary chain:
get message(): string {
 return this.reason === "missing"
  ? `missing ${this.key}`
  : this.reason === "invalid"
    ? `invalid ${this.key}`
    : `conflict on ${this.key}`;
}
```

## Foreign JSON contracts: `TaggedClass` owns `_tag`, `Schema.tag` serves everyone else

`Schema.TaggedClass` hardwires its discriminator key to `_tag` (the vendored
`TaggedStruct` is `Simplify<{ readonly _tag: tag<Tag> } & Fields>`,
`Schema.ts:6325`), so it
serves only contracts **we** own. When shaping classes to a foreign JSON
contract whose discriminator has its own name — mdast's `type`, JSON Schema's
`type`/`$ref`, OpenAPI, LSP — use `Schema.Class` with `Schema.tag("literal")`
on an explicitly-named field:

```ts
export class Paragraph extends Schema.Class<Paragraph>("Paragraph")({
 type: Schema.tag("paragraph"), // the FOREIGN key, not _tag
 children: PhrasingContent,
}) {}
```

`Schema.tag` gives the same three properties `TaggedClass` would: a
constructor default (`X.make` omits it), literal narrowing for union
branching, and presence on the encoded side. `@effected/markdown`'s
`MarkdownNode` classes are the worked precedent — the encoded trees are
spec-valid mdast because the tag field is literally named `type`.

While here, the factory-signature trap between the two
(`Schema.ts:17577`/`:17637`): `Schema.Class<Self>("Identifier")(fields)` takes
the **identifier in the first call** and fields in the second, while
`Schema.TaggedClass<Self>()("Tag", fields)` takes an **optional identifier
first** and the tag+fields in the second. Mixing them up produces confusing
inference errors, not a clear TS message.

For any other field, the general form is `Schema.withConstructorDefault`, and
its argument is an **Effect**, not a thunk and not an `Option`
(`defaultValue: Effect.Effect<...>`, `Schema.ts:6000`):
`field.pipe(Schema.withConstructorDefault(Effect.succeed(value)))`. Passing a
thunk like `() => Option.some(value)` typechecks against nothing helpful and
dies at construction with the unhelpful defect `Fiber.runLoop: Not a valid
effect`. The default runs per construction — a `succeed({})` object is NOT
shared across instances.
