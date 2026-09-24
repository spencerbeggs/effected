---
name: effect-v4-schema
description: Use when designing, reading, reviewing, or debugging any Effect v4 Schema — the Class-vs-Struct decision, fields and optionality, checks/refine/makeFilter, tagged unions, transformations and codecs (decodeTo, the FromString static), make-vs-new construction, brand/Opaque scalars, custom Equal/Hash, and derived tooling (Arbitrary.schema, toJsonSchemaDocument). Also covers primitives, records, recursive schemas, custom declare types, serialization (JSON/XML/FormData), and error formatting.
---

# Effect v4 Schema

The single skill for Effect v4 `Schema`. (For which of the `Schema*` satellite
modules is consumer-facing vs machinery, see `effect-v4-module-index`.) It
carries three layers:

1. **The house rules** — the [Do this, not this](#do-this-not-this) table below,
   our opinionated defaults distilled from the `@effected` packages.
2. **[references/house-style.md](./references/house-style.md)** — the worked
   examples and the reasoning behind each rule (the traps that only surface at
   test/property-test time).
3. **[`references/`](./references/)** — **Effect's own canonical Schema guide**
   (`Effect-TS/effect`, `packages/effect/SCHEMA.md`) split by topic, for the exhaustive
   detail on any construct.

Do not load all references at once — each is a standalone topic (some >1000
lines).

## Do this, not this

Each row is a hard house default; reasoning and worked code in
[house-style.md](./references/house-style.md).

Naming trap: `Schema.TaggedErrorClass` and `Schema.ErrorClass` are both
`undefined` on the `Schema` namespace — the current names are
`Schema.TaggedError` and `Schema.Error` (`Schema.ts:14488`), with the same
curried call shape. Code written against the older names fails with
"TaggedErrorClass is not a function".

| Do | Not |
| --- | --- |
| `Schema.Class` / `TaggedClass` / `TaggedError` for any reusable model, union member, or error | a bare `Schema.Struct` for a domain type — `Struct` is for throwaway inline shapes |
| `X.make({...})` as the default constructor — EXCEPT `TaggedError`, where failing with the yieldable `yield* new SomeError({...})` is the house idiom (glob, workspaces, walker all construct errors with `new`) | `new X({...})` for models outside a measured hot path (both validate identically) |
| reach for `{ disableChecks: true }` only to accept *trusted* data that would fail a `.check(...)` | reach for it as a **speed** switch — despite a docstring promising to "skip validation" (`Schema.ts:108`), it gates only the check phase: a failing `.check(...)` is skipped but a *type* error still throws, and the structural re-parse still runs. There is no speed to buy: a depth-20 recursive build measures **sub-millisecond either way**, with or without it — see the retracted exponential-cost claim below for what the numbers were once wrongly believed to be |
| treat a nested `Schema.Class` field identically whether it is **foreign** or **self-recursive** — both accept a plain literal, deep-validate it, promote it to a real instance, and pass a real instance through **by reference** ([table](#a-nested-schemaclass-field-foreign-and-self-recursive-behave-identically)) | assume the two ever split — that a self-recursive field *rejects* literals, or that a foreign field is re-constructed so `Outer.make({ inner: x }).inner !== x`. A **prototype-forged** instance is accepted unexamined either way |
| dodge the class factory's reserved static names when designing domain statics — every `Schema.Class`/`TaggedClass`/`TaggedError` base already declares `identifier`, `fields`, `ast`, `pipe`, `rebuild`, `make`, `makeOption`, `makeEffect`, `annotate`, `annotateKey`, `check`, `extend`, `mapFields` (`makeClass`, `Schema.ts:14453`; all thirteen confirmed present by probe, against a control key correctly reported absent) | a domain static reusing one of those names — an incompatible signature is a TS2417 compile error (*static side incorrectly extends base*); the lockfiles port had to rename an approved `LockfileIntegrity.check(lockfile, manifests)` design to `compare` on exactly this |
| name a validating string constructor `parse` / `parseResult` — **`make` is reserved and cannot be overloaded**, and this pair is the kit-wide shape ([worked example](#the-reserved-make-collision-parse--parseresult-is-the-house-resolution)) | `static make(raw: string)` on a `Schema.Class` — TS2417, every time |
| conditional-spread an absent optional field | pass an explicit `undefined` for a `Schema.optionalKey` — a *present* `undefined` throws |
| cross-field validation on a class: pass a **checked Struct** to the factory — `Schema.Class<X>("X")(Schema.Struct(fields).check(...))`; `check` returns `this["Rebuild"]` (`Schema.ts:187`), so a checked `Struct<Fields>` is still a `Struct<Fields>` the factory accepts, and the check sees the whole record (worked precedent: `CacheKey`'s restore-depths bound against its own segment count) | per-field checks that need a sibling's value (a field check sees only its field), or validating cross-field invariants in a `parse` wrapper the direct `make` path never runs |
| `Schema.optionalKey` for object fields — it yields `field?: T`, the exact-optional contract these `exactOptionalPropertyTypes` repos want ([why](#schemaoptional-is-not-exact-optional)) | `Schema.optional` unless the *value* itself must carry `undefined` — it is documented as "Equivalent to `optionalKey(UndefinedOr(S))`" (`Schema.ts:2476`), so it yields `field?: T \| undefined` and **admits `{ field: undefined }`** |
| `.check(is*)` to constrain, `refine` to narrow, `check(makeFilter(...))` for cross-field | `positive`/`negative`, or the `filter`/`greaterThan` spellings — none of them exist |
| tagged unions of `TaggedClass` members (`_tag` branching) | untagged unions for domain variants |
| `Schema.Literals(["a", "b", "c"])` for any multi-literal union (reason fields, enums) | the variadic `Schema.Literal("a", "b", "c")` — v4 `Literal` takes ONE argument; tsgo rejects the variadic call (TS2554), but the **runtime silently keeps only the first literal**, so a suite run before typecheck green-lights a schema that rejects every other member: `Schema.Literal("a","b","c")` accepts `"a"`, rejects `"b"` and `"c"` |
| `Source.pipe(decodeTo(Target, SchemaTransformation.transform({...})))` | a top-level `Schema.transform` / `transformEffect` — **not callable** — both are `undefined` on the `Schema` namespace |
| pin `transformEffect`'s type params explicitly when a union codec's members carry instance methods — `SchemaTransformation.transformEffect<(typeof Classified)["Encoded"], string>({...})` | relying on inference after adding an instance method to a `Schema.TaggedClass` union member — `transformEffect` unifies one `T` from decode-out and encode-in, and `decodeTo` pins both to the union's **Encoded** side, which no longer satisfies the method-bearing instance type; the existing codec breaks at the declaration site (hit adding a method to a `DependencySpecifier.FromString` member) |
| return an **`Effect`** from both `transformEffect` callbacks, failing with `SchemaIssue.InvalidValue({ message }, value)` ([contract](#transformeffects-callback-contract)) | return a `Result` (or a bare value) from a `transformEffect` callback — the signature demands `Effect<T, SchemaIssue.Issue, R>` (`SchemaTransformation.ts:380`); a `Result` is not an Effect and will not bridge itself |
| a `FromString` `Schema.Codec<Self, string>` static (string = the encoded form of the same schema) | a second parser divorced from the schema |
| `cause: Schema.Defect()` on an error class | `cause: Schema.Defect` — the bare (uncalled) form throws at construction (`Schema.ts:8732` is a *function*; `Schema.ErrorInstance` at `:8656` is the same trap — `Schema.Error` (`:14804`) is the error-**class factory**, not an instance schema — full list of the call-not-value family in **`effect-v4-idioms`**) |
| `Schema.decodeUnknownEffect` / `encodeUnknownEffect` in Effect flows | `*Sync` outside a genuine sync boundary |
| `Schema.fromJsonString(S)` (`Schema.ts:9198`) when the encoded form is a JSON **string** — one codec that parses-then-decodes and encodes-then-stringifies (`reviver` / `replacer` / `space` options); for a config or action input, `Config.schema(Schema.fromJsonString(S), "NAME")` (`Config.ts:877`) — behaviour under `withDefault` is probed and written up in **`effect-v4-idioms`** | `JSON.parse` / `JSON.stringify` around `decodeUnknown*` / `encodeUnknown*` — a second parser divorced from the schema, with a throwing host call in the seam that no downstream `Effect.catch` sees (five such sites had accreted in `github-actions` before #769 caught them) |
| `Schema.DurationFromMillis` / `Schema.DateTimeUtcFromString` (composed with `Schema.fromJsonString` for byte stores) when the value must **serialize** | `Schema.Duration` / `Schema.DateTimeUtc` in a persisted or wire schema — both are `declare` schemas with **no JSON encoding** (`Schema.ts:12016,13415`), so they round-trip in memory and fail at the serialization boundary; the ts-vfs cache metadata hit exactly this |
| annotate recursive `Schema.suspend` refs `Schema.Codec<T>` (services default `never`) | `Schema.Schema<T>` as the suspend annotation — it compiles at the declaration but leaves `DecodingServices` `unknown`, so every decode entrypoint rejects the schema (`unknown is not assignable to never`); a schema nobody decodes directly hides the trap until a consumer tries |
| derive variants via `mapFields(Struct.pick/omit/map(...))` | duplicate a schema to re-encode the same data |
| attach brand statics with `Object.assign`; export the type as `string & Brand.Brand<"N">` | try to merge a `namespace` into the brand `const` (impossible) |
| override BOTH `[Equal.symbol]` AND `[Hash.symbol]` when equality ignores fields | override `[Equal.symbol]` alone — the hash fast-path silently defeats it |
| `Schema.isSchema(x)` (`Schema.ts:2261`) to recognise a schema value at runtime — every schema is a **function** (`typeof === "function"`) ([why](#a-schema-value-is-a-function-at-runtime)) | `typeof x === "object" && x !== null` as a schema guard — it rejects **every** schema, so a config loader that "accepts objects" silently drops all of them |
| `S extends Schema.ConstraintDecoder<unknown>` as the bound of a helper that wraps `decodeUnknownResult` / `decodeUnknownExit` / `decodeUnknownOption` — that is the bound core's own decode entry points use (`Schema.ts:1668,1540,1606`) | `S extends Schema.Top` — `Top` erases `DecodingServices` to `unknown`, so the helper's call into `decodeUnknownResult` fails to type-check (`unknown` is not assignable to `never`); `Top` is for utilities that never decode (its docstring at `Schema.ts:737` sends decode-only APIs to `ConstraintDecoder`) |
| `Schema.toJsonSchemaDocument(S)` | `Schema.toJsonSchema(S)` — that export does not exist. It returns `{ dialect, schema, definitions }`, **not** `$defs` / `properties` |
| a single-return **ternary chain** in an error's `message` getter | an exhaustive `switch` with no terminal return — tsgo accepts it, but Biome's `useGetterReturn` rejects it (see below) |
| `Schema.Class` + `Schema.tag("literal")` on an explicitly-named field when the discriminator belongs to a FOREIGN contract | `Schema.TaggedClass` for a foreign discriminator — it hardwires the key `_tag` (see below) |

## Decoding tolerates excess keys silently — and a typo is the common case

`Schema.Struct` **drops unknown keys without complaint** on decode under
`onExcessProperty`'s default of `"ignore"` — `"error"` rejects them and
`"preserve"` keeps them, but you get `"ignore"` unless you ask. A struct of
all-`optionalKey` fields decodes `{ mxa: 100 }` to `{}` and reports success, so a
typo'd key and a correct-but-absent one are indistinguishable.

| Do this | Not this |
| --- | --- |
| `Schema.decodeUnknownEffect(S)(input, { onExcessProperty: "error", errors: "all" })` for anything a **human typed** | a bare decode of user-authored config, where a typo is silently discarded |
| let it default to `"ignore"` for a **machine-produced** payload you do not own | `"error"` on a third-party API response, which breaks the moment they add a field |

Two failures this has already caused in the kit, from independent directions:

- A typo'd rule-option key passed config validation, so the rule ran on defaults
  while the design promised "a typo'd option fails loudly naming the field"
  (`@effected/yaml` lint system, #129).
- A config loader could report neither a typo'd section **nor a field the schema
  deliberately removed** — a user migrating an older file kept a dead credential
  and was told nothing (`@spencerbeggs/reposets`, 2026-08-13). Their first
  conclusion was that v4 had dropped the feature entirely, and they began writing
  one hand-rolled filter per removed field before a probe found `onExcessProperty`
  alive and well.

Pair it with **`errors: "all"`**. The default reports the first issue only, so a
file with three typos surfaces one per run — fix, re-run, discover the next. The
extra work only happens on a document that is already failing.

**A rest does not make a struct stricter — it switches excess checking off.**
This is the opposite of what the shape suggests, and it is worth probing rather
than reasoning about:

| Spelling | `{ a: "x", b: 1 }` under `onExcessProperty: "error"` |
| --- | --- |
| `Schema.Struct({ a })` | **rejected** — the strict path |
| `Schema.StructWithRest(Struct({ a }), [Record(String, Unknown)])` | **accepted**, and `b` is *preserved* |
| `Schema.Struct({ a }, { rest: Never })` | accepted, `b` dropped — v4's `Struct` takes only `fields`, so a `rest` option is an ignored extra argument |
| `Schema.StructWithRest(Struct({ a }), [Record(String, Never)])` | rejected — but so is the valid `{ a: "x" }`, because the index signature covers `a` too |

`SchemaAST.ts` runs the excess pass only when the struct has no index signature,
so **owning a rest disables it for that struct entirely**, not merely for the
keys the rest covers. A schema that deliberately admits a pass-through section
therefore keeps working under `"error"` — but it is permissive about *every*
key at that level, and siblings without a rest stay strict independently.

So a rest cannot express "these keys and no others" in either direction, and
`onExcessProperty: "error"` is the only strict path.

## `Schema.optional` is not exact-optional

These repos compile with `exactOptionalPropertyTypes: true`, and the two
optionality combinators differ in exactly the way that setting cares about:

```ts
Schema.optional(Schema.String)      // field?: string | undefined  — { field: undefined } is LEGAL
Schema.optionalKey(Schema.String)   // field?: string             — { field: undefined } is TS2375
```

The mechanism is in the vendored source — `optional` is `optionalKey` widened
with `UndefinedOr`:

```ts
// Schema.ts:2379 — the docstring at :2357 reads "Equivalent to `optionalKey(UndefinedOr(S))`"
export const optional = Struct_.lambda<optionalLambda>((self) => {
  const schema = UndefinedOr(self)
  return make(SchemaAST.optional(self.ast), { schema })
})
```

**The trap is that `Schema.optional` reads like the neutral default and
compiles clean.** Nothing fails; the schema simply admits a present-but-
`undefined` key forever after. A partial-merge patch schema
(`{ name, url?, path?, sha? }`) built with `Schema.optional` type-checked, and
`{ name: "a", url: undefined }` still compiled — violating the "omitted fields
are absent" invariant the patch depended on. Only review caught it.

Probed, `packages/semver` (control: `Schema.optionalElement`
→ TS2339, harness live):

```text
optional    + explicit undefined -> compiles (no error)          <-- the bug
optionalKey + explicit undefined -> TS2375 ... with 'exactOptionalPropertyTypes: true'
```

`optionalKey` also lowers cleaner: the field is absent from `required` in the
derived JSON Schema, with no `undefined`/`null` sentinel in the type. Reach for
`Schema.optional` **only** when the value genuinely must carry `undefined` as a
distinct inhabitant — not merely because the field is optional.

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
used by `SemVer`, `Range`, `Comparator`, `Jsonc`, `Markdown`, `MarkdownDocument`
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
while `parse`/`parseResult` own string input. (Why both forms: see
`formatter-convention` in the design docs. The `Effect.fromResult` bridge, and
why `yield* someResult` does not work, are owned by `effect-v4-idioms`.)

## `transformEffect`'s callback contract

Both callbacks must return an **`Effect`** — not a `Result`, not a bare value —
failing with a `SchemaIssue`. The vendored signature
(`SchemaTransformation.ts:380`):

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
`(annotations?, input?, options?)` (`SchemaIssue.ts:745`), not
`(Option.some(s), { message })` — a plain annotations object is the first
argument, with no `Option` wrapper. The input is retained on the issue only
when parse options set `reportInput: true` (`SchemaIssue.ts:167-168`);
`InvalidType`'s constructor is `(ast, input?, options?)`
(`SchemaIssue.ts:667`). If your transformation is infallible, use
`SchemaTransformation.transform` (plain values, no Effect) instead; reach for
`transformEffect` only when it can fail.

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
could fail and did not. **Do not pay for this probe again**, and do not
hand-write a recursive comparator for a class tree: `Equal.equals` already
is one. (It is also what keeps assertions stable across the identity churn
the table above documents.)

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
bookkeeping the `Person` codec below relies on — while still satisfying its type.
Guard anything that **replays a value onto the wire, or caches keyed on instance
identity**: treat instances as immutable by discipline, and rebuild with
`make` rather than assigning a field, because the type system will not stop you.

## A homogeneous-Type union is encode-lossy: keep the Type heterogeneous when the wire form must survive

`Schema.Union([A, A.FromString])` — the reflex for "accept either the object
or its string shorthand" — **cannot round-trip the input encoding** when both
members decode to the *same* Type. On encode the union collapses to the
**first** member that produces that Type, regardless of which branch decoded
the value. A value parsed from the string form re-encodes as the object form,
silently. This is the mechanism behind the round-4 `@effected/package-json`
`Person` data-loss bug (string-form `author` rewritten to object form), and it
is why `Person.FromValue` carries a `wireForms` WeakMap plus a faithfulness
check — the union cannot remember which branch a value came from, so the code
must.

Probed, `packages/package-json`, with a control proving the object form
round-trips:

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

Two more riders, both learned the hard way in that package:

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

Verified through `pnpm lint` (a bare `npx biome check <file>` from inside a
package exits 0 without reading the repo config — it is not a check).

## Foreign JSON contracts: `TaggedClass` owns `_tag`, `Schema.tag` serves everyone else

`Schema.TaggedClass` hardwires its discriminator key to `_tag` (the vendored
`TaggedStruct` is `Simplify<{ readonly _tag: tag<Tag> } & Fields>`,
`Schema.ts:6133`), so it
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
(`Schema.ts:14686`/`14745`): `Schema.Class<Self>("Identifier")(fields)` takes
the **identifier in the first call** and fields in the second, while
`Schema.TaggedClass<Self>()("Tag", fields)` takes an **optional identifier
first** and the tag+fields in the second. Mixing them up produces confusing
inference errors, not a clear TS message.

For any other field, the general form is `Schema.withConstructorDefault`, and
its argument is an **Effect**, not a thunk and not an `Option`
(`defaultValue: Effect.Effect<...>`, `Schema.ts:5651`):
`field.pipe(Schema.withConstructorDefault(Effect.succeed(value)))`. Passing a
thunk like `() => Option.some(value)` typechecks against nothing helpful and
dies at construction with the unhelpful defect `Fiber.runLoop: Not a valid
effect`. The default runs per construction — a `succeed({})` object is NOT
shared across instances.

## A `Schema.check` narrowing is ERASED from the published type

A check narrows what **decodes**, not what the value is **typed** as — so a
checked schema and its base publish as the *same* declared type.
`CorepackIntegrityHash` (corepack-form-only) and the wide `IntegrityHash`
brand both emit as `Schema.brand<Schema.String, "IntegrityHash">` in
`@effected/npm`'s built `.d.ts`; a consumer reading the types cannot tell
them apart. The consequence bites in two directions:

- **A faithful private re-fork of a shared checked schema is invisible** to
  `tsc` AND to every behavioral test — the mutant that re-forks the schema
  keeps the entire rejection matrix green. When two modules must share a
  checked narrowing of one brand, the only proven guard is a **runtime
  identity assertion** on the consumer's field schema
  (`X.fields.integrity.schema === CorepackIntegrityHash`; through
  `Schema.Option`, `.fields.<name>.value === …`), with a control proving it
  discriminates (`=== IntegrityHash` must be false). The failing assert
  prints "Compared values have no visual difference" — which is the point.
  Do not downgrade it to a behavioral test, which cannot fail, or a
  source-text import walker, which passes if the import is left unused.
- **A behavioral break can be type-invisible**: strictening a field's check
  (package-json's `PackageManager` version fold) ships a byte-identical
  `.d.ts` while previously-accepted inputs now fail at decode. Announce
  such changes loudly in handoffs — nothing downstream fails to compile.

## A schema value is a function at runtime

Every schema — `Schema.String`, a `Struct`, a `Literals`, a `Schema.Class`
factory result, a `.check(...)`-ed schema — is built by `internal/schema/make.ts:27`
as `function Schema() {}` with its prototype swapped to the schema proto, so
`typeof` reports `"function"`, never `"object"`. Probed against a
control (`Schema.isSchema(42)` → `false`):

```text
Schema.String:                        typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Struct({...}):                 typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Literals([...]):               typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Class factory result (Person): typeof=function  isSchema=true  objectGuardAccepts=false
Schema.String.check(...):             typeof=function  isSchema=true  objectGuardAccepts=false
```

The trap this replaces: a `typeof value === "object"` guard in a config loader
that classified every user-supplied schema as "not a schema" and reported a
config with five schemas as declaring none — a false *negative* the loader's
own tests could not see because their fixtures were objects too. Use
`Schema.isSchema` (`Schema.ts:2261`, a `TypeId` brand check), and when a guard
must also accept plain objects, test `isSchema` **first**.

## Verify against the installed source, not the references

The `references/` track **upstream `Effect-TS/effect` main**, which runs AHEAD
of this repo's pinned `effect`. Treat them as authoritative on *shape and
intent*, not on exact export names. Before relying on any specific API, probe
it from a package on the v4 catalog:

```bash
node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.TheApiYouWant)"
```

If it prints `undefined`, the name moved or has not landed yet — check
`node_modules/effect/dist/Schema.d.ts`, or climb the `effect-v4-source-lookup`
ladder. The "Do this, not this" rules above already fold in the gotchas the
upstream prose does not flag.

The skew is real and it cuts both ways: the vendored `09-classes-and-opaque-types`
reference still documents `Schema.asClass`, which is **`undefined`** —
you now subclass the schema value directly (`class MyString extends Schema.String {}`).

## Reference map

Load the one section you need. Each file carries a provenance banner (upstream
source + the beta-skew warning).

| Reference | Load when |
| --- | --- |
| [01-overview](./references/01-overview.md) | Orienting on the design philosophy — codecs, the Type/Encoded split, the `~`-prefixed internal type members. |
| [02-elementary-schemas](./references/02-elementary-schemas.md) | Primitives, literals, strings & string formats, numbers/integers/bigints, dates, template literals. |
| [03-composite-schemas](./references/03-composite-schemas.md) | Structs, tuples, arrays, records, unions, recursive schemas. The biggest section — the day-to-day modeling vocabulary. |
| [04-custom-types](./references/04-custom-types.md) | Declaring a schema for a type Schema doesn't know — `Schema.declare` (non-parametric) and `declareConstructor` (parametric). |
| [05-validation](./references/05-validation.md) | Filters as first-class, checks/refinements/branding, structural & effectful filters, multiple-issue reporting, aborting, filter groups & factories. |
| [06-constructors](./references/06-constructors.md) | `make` in composed/branded/refined schemas, default values (incl. effectful defaults). |
| [07-transformations](./references/07-transformations.md) | `decodeTo`/`encodeTo`, the transformation type, composing, passthrough helpers, optional-key management, omit-on-encode. |
| [08-flipping-schemas](./references/08-flipping-schemas.md) | `Schema.flip` — swapping Type and Encoded, and what it does to constructors. |
| [09-classes-and-opaque-types](./references/09-classes-and-opaque-types.md) | Opaque structs, schema-as-a-class, the `Schema.Class` family (methods, statics, extension). |
| [10-serialization](./references/10-serialization.md) | JSON, string-encoding, FormData, URLSearchParams, canonical codecs, the XML encoder. |
| [11-generation-and-tooling](./references/11-generation-and-tooling.md) | Deriving JSON Schema (`onExcessProperty`, open by default), the native `effect/unstable/arbitrary` generator (no fast-check bridge; size clamp, `-0`, exhaustion and regexp traps), Equivalence, Optic; type-safe JSON patches via Differ. |
| [12-schema-representation](./references/12-schema-representation.md) | The introspectable representation data model, its limitations, JSON round-tripping, rebuilding runtime schemas, code generation. |
| [13-error-handling-and-formatting](./references/13-error-handling-and-formatting.md) | `SchemaError`/`SchemaIssue`, formatters, Standard-Schema-v1 issue output. |
| [14-middlewares](./references/14-middlewares.md) | Decode/encode middlewares and fallbacks. |
| [15-advanced-topics](./references/15-advanced-topics.md) | The internal model, type hierarchy, typed annotations, generics & separate requirement type params. |
| [16-integrations](./references/16-integrations.md) | Framework integrations (TanStack Form, Elysia). |

## Related skills

- **`effect-v4-idioms`** — core Effect patterns, and the **call-not-value** list
  (`Schema.Defect()`, `Schema.ErrorInstance()`, `TestClock.layer()`) — names that
  exist, type-check uncalled, and fail somewhere else.
- **`effect-v4-source-lookup`** — when a Schema name doesn't resolve:
  the evidence ladder that settles existence, signature and semantics.
- **`effect-api-extractor-bases`** — the anonymous-base / `ae-forgotten-export`
  discipline for `Schema.Class` and `Context.Service`.
- **`effect-v4-services-layers`** — the sibling for `Context.Service` and Layers.
- **`effect-v4-planning`** — design a schema/service before writing it.
