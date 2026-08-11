---
name: effect-v4-schema
description: Use when designing, reading, reviewing, or debugging any Effect v4 Schema — the Class-vs-Struct decision, fields and optionality, checks/refine/makeFilter, tagged unions, transformations and codecs (decodeTo, the FromString static), make-vs-new construction, brand/Opaque scalars, custom Equal/Hash, and derived tooling (toArbitrary, toJsonSchemaDocument). Also covers primitives, records, recursive schemas, custom declare types, serialization (JSON/XML/FormData), and error formatting. Verified against effect@4.0.0-beta.101; for v3→v4 renames see effect-v4-construct-map.
---

# Effect v4 Schema

The single skill for Effect v4 `Schema`. (For which of the `Schema*` satellite
modules is consumer-facing vs machinery, see `effect-v4-module-index`.) It
carries three layers:

1. **The house rules** — the [Do this, not this](#do-this-not-this) table below,
   our opinionated defaults distilled from the `@effected` migrations.
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

Naming trap: beta.102–105 renamed `Schema.TaggedErrorClass` back to
`Schema.TaggedError` (same curried call shape; `Schema.ErrorClass` likewise
became `Schema.Error`) — code written against earlier v4 betas fails with
"TaggedErrorClass is not a function" (`Schema.ts:14466`).

| Do | Not |
| --- | --- |
| `Schema.Class` / `TaggedClass` / `TaggedError` for any reusable model, union member, or error | a bare `Schema.Struct` for a domain type — `Struct` is for throwaway inline shapes |
| `X.make({...})` as the default constructor — EXCEPT `TaggedError`, where failing with the yieldable `yield* new SomeError({...})` is the house idiom (glob, workspaces, walker all construct errors with `new`) | `new X({...})` for models outside a measured hot path (both validate identically) |
| reach for `{ disableChecks: true }` only to accept *trusted* data that would fail a `.check(...)` | reach for it as a **speed** switch — despite a docstring promising to "skip validation", it gates only the check phase: type errors still throw, the structural re-parse still runs, and a depth-20 build measured 2671 ms with it vs 2711 ms without |
| know which nested-class row you are in — a **self-recursive** field (any AST node) takes only real instances and checks them by instance alone; a **foreign** class field takes a literal, deep-validates it, and hands back a re-constructed value ([table](#a-nested-schemaclass-field-self-recursive-behaves-nothing-like-foreign)) | assume the two behave alike, or assert a nested class value with `strictEqual` — a foreign field is re-constructed, so `Outer.make({ inner: x }).inner !== x` |
| dodge the class factory's reserved static names when designing domain statics — every `Schema.Class`/`TaggedClass`/`TaggedError` base already declares `identifier`, `fields`, `ast`, `pipe`, `rebuild`, `make`, `makeOption`, `makeEffect`, `annotate`, `annotateKey`, `check`, `extend`, `mapFields` (vendored `Schema.ts` `makeClass`) | a domain static reusing one of those names — an incompatible signature is a TS2417 compile error (*static side incorrectly extends base*); the lockfiles port had to rename an approved `LockfileIntegrity.check(lockfile, manifests)` design to `compare` on exactly this |
| name a validating string constructor `parse` / `parseResult` — **`make` is reserved and cannot be overloaded**, and this pair is the kit-wide shape ([worked example](#the-reserved-make-collision-parse--parseresult-is-the-house-resolution)) | `static make(raw: string)` on a `Schema.Class` — TS2417, every time |
| conditional-spread an absent optional field | pass an explicit `undefined` for a `Schema.optionalKey` — a *present* `undefined` throws |
| cross-field validation on a class: pass a **checked Struct** to the factory — `Schema.Class<X>("X")(Schema.Struct(fields).check(...))`; `check` returns `this["Rebuild"]` (`Schema.ts:187`), so a checked `Struct<Fields>` is still a `Struct<Fields>` the factory accepts, and the check sees the whole record (worked precedent: `CacheKey`'s restore-depths bound against its own segment count) | per-field checks that need a sibling's value (a field check sees only its field), or validating cross-field invariants in a `parse` wrapper the direct `make` path never runs |
| `Schema.optionalKey` for object fields — it yields `field?: T`, the exact-optional contract these `exactOptionalPropertyTypes` repos want ([why](#schemaoptional-is-not-exact-optional)) | `Schema.optional` unless the *value* itself must carry `undefined` — it is literally `optionalKey(UndefinedOr(self))` (`Schema.ts:2386`), so it yields `field?: T \| undefined` and **admits `{ field: undefined }`** |
| `.check(is*)` to constrain, `refine` to narrow, `check(makeFilter(...))` for cross-field | the removed `positive`/`negative` or the v3 `filter`/`greaterThan` names |
| tagged unions of `TaggedClass` members (`_tag` branching) | untagged unions for domain variants |
| `Schema.Literals(["a", "b", "c"])` for any multi-literal union (reason fields, enums) | the v3 variadic `Schema.Literal("a", "b", "c")` — v4 `Literal` takes ONE argument; tsgo rejects the variadic call (TS2554), but the **runtime silently keeps only the first literal**, so a suite run before typecheck green-lights a schema that rejects every other member |
| `Source.pipe(decodeTo(Target, SchemaTransformation.transform({...})))` | a top-level `Schema.transform` / `transformOrFail` — **not callable** — both are `undefined` on the `Schema` namespace, re-verified beta.101 |
| pin `transformOrFail`'s type params explicitly when a union codec's members carry instance methods — `SchemaTransformation.transformOrFail<(typeof Classified)["Encoded"], string>({...})` | relying on inference after adding an instance method to a `Schema.TaggedClass` union member — `transformOrFail` unifies one `T` from decode-out and encode-in, and `decodeTo` pins both to the union's **Encoded** side, which no longer satisfies the method-bearing instance type; the existing codec breaks at the declaration site (hit on beta.98 adding a method to a `DependencySpecifier.FromString` member) |
| return an **`Effect`** from both `transformOrFail` callbacks, failing with `SchemaIssue.InvalidValue({ message }, value)` ([contract](#transformorfails-callback-contract)) | return a `Result` (or a bare value) from a `transformOrFail` callback — the signature demands `Effect<T, SchemaIssue.Issue, R>` (`SchemaTransformation.ts:286`); a `Result` is not an Effect and will not bridge itself |
| a `FromString` `Schema.Codec<Self, string>` static (string = the encoded form of the same schema) | a second parser divorced from the schema |
| `cause: Schema.Defect()` on an error class | `cause: Schema.Defect` — the bare (uncalled) form throws at construction (`Schema.ts:10747` is a *function*; `Schema.ErrorInstance` at `:10647` is the same trap — beta.102–105 renamed it from `Schema.Error`, which is now the error-**class factory** at `:14405`, not an instance schema — full list of the call-not-value family in **`effect-v4-construct-map`**) |
| `Schema.decodeUnknownEffect` / `encodeUnknownEffect` in Effect flows | `*Sync` outside a genuine sync boundary |
| `Schema.DurationFromMillis` / `Schema.DateTimeUtcFromString` (composed with `Schema.fromJsonString` for byte stores) when the value must **serialize** | `Schema.Duration` / `Schema.DateTimeUtc` in a persisted or wire schema — both are `declare` schemas with **no JSON encoding** (`Schema.ts:10575,11972`), so they round-trip in memory and fail at the serialization boundary; the ts-vfs cache metadata hit exactly this |
| annotate recursive `Schema.suspend` refs `Schema.Codec<T>` (services default `never`) | `Schema.Schema<T>` as the suspend annotation — it compiles at the declaration but leaves `DecodingServices` `unknown`, so every decode entrypoint rejects the schema (`unknown is not assignable to never`, probed beta.94); a schema nobody decodes directly hides the trap until a consumer tries |
| derive variants via `mapFields(Struct.pick/omit/map(...))` | duplicate a schema to re-encode the same data |
| attach brand statics with `Object.assign`; export the type as `string & Brand.Brand<"N">` | try to merge a `namespace` into the brand `const` (impossible) |
| override BOTH `[Equal.symbol]` AND `[Hash.symbol]` when equality ignores fields | override `[Equal.symbol]` alone — the hash fast-path silently defeats it |
| `Schema.toJsonSchemaDocument(S)` | `Schema.toJsonSchema(S)` — that export does not exist. It returns `{ dialect, schema, definitions }`, **not** `$defs` / `properties` |
| a single-return **ternary chain** in an error's `message` getter | an exhaustive `switch` with no terminal return — tsgo accepts it, but Biome's `useGetterReturn` rejects it (see below) |
| `Schema.Class` + `Schema.tag("literal")` on an explicitly-named field when the discriminator belongs to a FOREIGN contract | `Schema.TaggedClass` for a foreign discriminator — it hardwires the key `_tag` (see below) |

## `Schema.optional` is not exact-optional

These repos compile with `exactOptionalPropertyTypes: true`, and the two
optionality combinators differ in exactly the way that setting cares about:

```ts
Schema.optional(Schema.String)      // field?: string | undefined  — { field: undefined } is LEGAL
Schema.optionalKey(Schema.String)   // field?: string             — { field: undefined } is TS2375
```

The mechanism is one line of the vendored source — `optional` is `optionalKey`
wrapped in `UndefinedOr`:

```ts
// Schema.ts:2386
export const optional = Struct_.lambda<optionalLambda>((self) => optionalKey(UndefinedOr(self)))
```

**The trap is that `Schema.optional` reads like the neutral default and
compiles clean.** Nothing fails; the schema simply admits a present-but-
`undefined` key forever after. A partial-merge patch schema
(`{ name, url?, path?, sha? }`) built with `Schema.optional` type-checked, and
`{ name: "a", url: undefined }` still compiled — violating the "omitted fields
are absent" invariant the patch depended on. Only review caught it.

Probed, `packages/semver`, `effect@4.0.0-beta.99` (control: `Schema.optionalElement`
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

## `transformOrFail`'s callback contract

Both callbacks must return an **`Effect`** — not a `Result`, not a bare value —
failing with a `SchemaIssue`. The vendored signature
(`SchemaTransformation.ts:286`):

```ts
export function transformOrFail<T, E, RD = never, RE = never>(options: {
  readonly decode: (e: E, options: SchemaAST.ParseOptions) => Effect.Effect<T, SchemaIssue.Issue, RD>
  readonly encode: (t: T, options: SchemaAST.ParseOptions) => Effect.Effect<E, SchemaIssue.Issue, RE>
}): Transformation<T, E, RD, RE>
```

The house failure shape is `InvalidValue` carrying a message annotation, with
the offending value as the second argument:

```ts
Schema.String.pipe(Schema.decodeTo(Schema.Date,
  SchemaTransformation.transformOrFail({
    decode: (s) => {
      const d = new Date(s);
      return isNaN(d.getTime())
        ? Effect.fail(new SchemaIssue.InvalidValue({ message: "Invalid date" }, s))
        : Effect.succeed(d);
    },
    encode: (d) => Effect.succeed(d.toISOString()),
  })))
```

Signature trap: beta.102–105 changed the constructor to
`(annotations?, input?, options?)` (`SchemaIssue.ts:572`) — the earlier v4
shape `new SchemaIssue.InvalidValue(Option.some(s), { message })` no longer
type-checks: the `Option` wrapper is gone and the argument order flipped.
The input is retained on the issue only when parse options set
`reportInput: true` (`SchemaIssue.ts:151`); `InvalidType` is now
`(ast, input?, options?)` (`SchemaIssue.ts:511`). If your
transformation is infallible, use `SchemaTransformation.transform` (plain
values, no Effect) instead; reach for `transformOrFail` only when it can fail.

## A nested `Schema.Class` field: self-recursive behaves nothing like foreign

`make`'s treatment of a class-typed field splits on **one axis — whether the
field's schema refers to the class currently being defined.** Everything else
(direct reference vs `Schema.suspend`, bare vs inside `Schema.Array`) makes no
difference. Probed at `effect@4.0.0-beta.101`; control: `make` rejects a bad
top-level field, so validation was live in every row.

| Field shape | plain-object literal | prototype-forged instance | passes a good instance through by reference |
| --- | --- | --- | --- |
| **foreign** class — `inner: Inner`, `suspend(() => Inner)`, `Array(suspend(() => Inner))` | accepted, **promoted** to a real instance | **rejected** — deep-validated | **no** — re-constructed |
| **self-recursive** — `suspend(() => Self)`, bare or inside `Array` | **rejected** (`Expected N, got {…}`) | **accepted** — instance check is the whole check | **yes** |

Read the consequences off the row you are actually in:

- **Foreign field.** Hand it a literal and it is validated and promoted, which
  is what you want. But `make` **re-constructs** it, so
  `Outer.make({ inner: x }).inner !== x`. Never assert a nested class value by
  reference; these are immutable value classes with structural equality, so
  compare with `deepStrictEqual` / `Equal.equals`. This is what the beta.101
  fix for [#6491](https://github.com/Effect-TS/effect/issues/6491) changed —
  through beta.99 a *constructor-defaulted* foreign field threw on a literal
  instead.
- **The "accepted" in that literal column is runtime truth; the TYPE level
  agrees only for member-less classes.** `make`'s input type for a foreign
  field is the class's **instance type** — and wrapping the field in
  `.pipe(Schema.check(...))` changes nothing on this axis (probed both ways
  at beta.101). A member-less value class is structurally satisfied by the
  literal, so it compiles; a class with any member the literal lacks (a
  getter, a method — most real classes) rejects the literal at compile time
  (TS2741 "property … missing in type", or TS2740) even though runtime would
  still validate, run the field's checks, and promote it. Do not read that
  error as "the check narrowed `make`" — the check is innocent — and do not
  cast the literal through; construct the instance
  (`Outer.make({ inner: Inner.make({...}) })`).
- **Self-recursive field** (every AST node type: `JsoncNode.children`,
  `MarkdownNode`, `TomlNode`). A structurally valid literal is **rejected** —
  you must build real instances, which bites hand-built trees and fixtures,
  though decoding from wire data is unaffected because that path parses. And a
  prototype-forged node is **accepted unexamined**, so anything that forges
  instances to skip validation owns correctness itself.
- **Construction is linear either way**: a self-recursive tree built
  node-by-node measured 0.12 ms at depth 25, flat from depth 10.

> **Retracted (was in this skill through beta.97):** that node-by-node
> construction of a recursive `Schema.Class` "re-validates its whole subtree,
> so cost **doubles per level** — depth 20 = 2.7 s, hangs past 25", and that an
> `Object.assign(Object.create(Proto), props)` bypass was therefore required.
> **It does not reproduce** — measured at beta.99 and again at beta.101, depth
> 20 is ~0.1–0.2 ms, four orders of magnitude off the old number, and stays
> flat to depth 60. Flat `TaggedClass.make` is likewise linear (10 k in 14.6 ms,
> 20 k in 20.7 ms). Do **not** add a validation bypass for cost reasons. Where
> one already exists (`@effected/jsonc`'s `makeNodeUnsafe`), it buys
> trusted-path construction against the self-recursive row above — not a rescue
> from quadratic blowup.

## Class-factory equality is deep and structural — but instances are not frozen

`Equal.equals` on two class-factory instances recurses. It is not reference
equality, and it is not shallow: it walks **nested `Schema.Class` fields**,
`Schema.optionalKey` fields (a present key and an absent one compare **unequal**,
which is the discrimination `exactOptionalPropertyTypes` semantics need), and
`Schema.Array`-of-class fields element by element. **`Hash` agrees wherever
`Equal` agrees**, so these instances are safe as `HashMap`/`HashSet` keys with no
custom `[Hash.symbol]`.

Probed at `effect@4.0.0-beta.101`, 14/14 including discriminating controls — a
one-field difference at each nesting depth compared unequal, so the probe could
fail and did not. **Do not pay for this probe again**, and do not hand-write a
recursive comparator for a class tree: `Equal.equals` already is one. (The
sibling fact — a *foreign* nested field is re-constructed by `make`, so `!==` by
reference — is the table above; deep `Equal.equals` is exactly what rescues it.)

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

Probed, `packages/package-json`, `effect@4.0.0-beta.99`:

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

## The `message` getter: ternary chain, not an exhaustive switch

Every `TaggedError` with a multi-reason `message` hits this. A `switch` over
a `Schema.Literals`-typed `reason` in which **every case returns** is exhaustive,
and tsgo is happy — but Biome's `lint/suspicious/useGetterReturn` sees a getter
with no terminal return and fails the lint gate:

> `× This getter should return a value.`

```ts
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
`TaggedStruct` is `{ _tag: tag<Tag> } & fields`, `Schema.ts:12880`), so it
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

While here, the factory-signature trap between the two (verified
`Schema.ts:12805`/`12865`): `Schema.Class<Self>("Identifier")(fields)` takes
the **identifier in the first call** and fields in the second, while
`Schema.TaggedClass<Self>()("Tag", fields)` takes an **optional identifier
first** and the tag+fields in the second. Mixing them up produces confusing
inference errors, not a clear TS message.

## A `Schema.check` narrowing is ERASED from the published type

A check narrows what **decodes**, not what the value is **typed** as — so a
checked schema and its base publish as the *same* declared type.
`CorepackIntegrityHash` (corepack-form-only) and the wide `IntegrityHash`
brand both emit as `Schema.brand<Schema.String, "IntegrityHash">` in
`@effected/npm`'s built `.d.ts`; a consumer reading the types cannot tell
them apart. Probed at beta.101, and the consequence bites in two directions:

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

## Verify against the installed beta, not the references

The `references/` track **upstream `Effect-TS/effect` main**, which runs AHEAD of the
pinned `effect` v4 beta in this repo. Treat them as authoritative on *shape
and intent*, not on exact export names. Before relying on any specific API, probe
it from a package on the v4 catalog:

```bash
node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.TheApiYouWant)"
```

If it prints `undefined`, the name moved or has not landed in beta.101 yet — check
`node_modules/effect/dist/Schema.d.ts` or the `effect-v4-construct-map` rename
tables. The "Do this, not this" rules above already fold in the beta.101 gotchas
the upstream prose does not flag.

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
| [11-generation-and-tooling](./references/11-generation-and-tooling.md) | Deriving JSON Schema, Arbitrary, Equivalence, Optic; type-safe JSON patches via Differ. |
| [12-schema-representation](./references/12-schema-representation.md) | The introspectable representation data model, its limitations, JSON round-tripping, rebuilding runtime schemas, code generation. |
| [13-error-handling-and-formatting](./references/13-error-handling-and-formatting.md) | `SchemaError`/`SchemaIssue`, formatters, Standard-Schema-v1 issue output. |
| [14-middlewares](./references/14-middlewares.md) | Decode/encode middlewares and fallbacks. |
| [15-advanced-topics](./references/15-advanced-topics.md) | The internal model, type hierarchy, typed annotations, generics & separate requirement type params. |
| [16-integrations](./references/16-integrations.md) | Framework integrations (TanStack Form, Elysia). |

## Related skills

- **`effect-v4-construct-map`** — the flat v3→v4 rename tables. Reach for it when a
  v3 Schema name doesn't resolve in beta.101, and for the **call-not-value** list
  (`Schema.Defect()`, `Schema.Error()`, `TestClock.layer()`) — names that exist,
  type-check uncalled, and fail somewhere else.
- **`effect-api-extractor-bases`** — the anonymous-base / `ae-forgotten-export`
  discipline for `Schema.Class` and `Context.Service`.
- **`effect-v4-services-layers`** — the sibling for `Context.Service` and Layers.
- **`effect-v4-planning`** — design a schema/service before writing it.
