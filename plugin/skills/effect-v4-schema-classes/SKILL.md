---
name: effect-v4-schema-classes
description: Use when designing an Effect v4 Schema domain model — the Class-vs-Struct decision, fields & optionality, checks/refine/makeFilter, tagged unions, transformations & codecs (FromString statics via decodeTo), make-vs-new construction, deriving instead of duplicating, brand/Opaque scalars, derived tooling (toArbitrary/toJsonSchemaDocument/…), and custom Equal/Hash. Covers the idiomatic v4 way plus the traps that only surface at test or property-test time (hash fast-path, lookahead regex, non-canonical field models). Verify every identifier against installed effect, not memory.
---

# Schema domain-model patterns (Effect v4)

The class IS the schema: one `Schema.Class` carries fields, validation,
methods, statics, and derived tooling (`toArbitrary`, `toEquivalence`,
`toJsonSchemaDocument`) in a single artifact. These patterns keep that artifact
idiomatic and sound. Everything below is verified against
`effect@4.0.0-beta.93`; v4 betas move fast, so probe anything not shown here
before writing it (`node --input-type=module -e "import * as S from
'effect/Schema'; console.log(typeof S.X)"`). For a v3→v4 name lookup, see the
`effect-v4-construct-map` skill — this skill teaches the idiomatic v4 shape, not
the rename table.

## Class vs Struct: the first decision

The guide's headline rule — reach for a **named class** for anything real, and
`Struct` only for throwaway inline shapes:

- reusable named model → `Schema.Class`
- reusable tagged-union member → `Schema.TaggedClass`
- reusable error payload → `Schema.TaggedErrorClass`
- small local/anonymous object shape → `Schema.Struct`

```ts
export class User extends Schema.Class<User>("User")({
 id: Schema.String,
 name: Schema.String,
}) {}

class Circle extends Schema.TaggedClass<Circle>()("Circle", {
 radius: Schema.Number,
}) {}

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
 id: Schema.String,
}) {}
```

A class buys you a stable identity, methods and statics, `instanceof`, and one
place to hang derived tooling. A `Struct` is for the query object you pass once
and forget.

## Construction: `make` is the default, `new` is a perf exception

The guide's idiomatic default is **`X.make({...})`** across all three class
variants — consistent, reads as schema construction:

```ts
const todo = Todo.make({ id: 1, title: "write docs", completed: false });
```

`new X({...})` and `X.make({...})` **validate identically** in v4 (both run the
structural parse; neither is a rubber stamp). Our ports keep `new` on hot paths
for a measured ~8% edge, but that is a deliberate performance exception, not the
general rule — write `make` unless you are in engine/hot-path code. Either way,
never pass an explicit `undefined` for a `Schema.optionalKey` field (a *present*
`undefined` is not an *absent* key and throws); use conditional spreads:
`new Node({ offset, ...(anchor !== undefined ? { anchor } : {}) })`. See
`effect-v4-construct-map` for the full construction/validation semantics.

**Instances are NOT `Pipeable` in v4** (first boundary port). The factory's
instance type is `S["Type"] & Inherited` — the decoded record plus any brand,
neither of which declares `Pipeable`. A runtime `.pipe` method exists on the
prototype, so it *runs*, but tsgo rejects instance `.pipe(...)`. If you want
pipeable instances — e.g. to call a dual-signature `Function.dual` static
pipeably (`node.pipe(Node.move(2))`) — retain the manual `Pipeable` overload
block on the class (the `pipe(...args) { return pipeArguments(this, args) }`
member) so the instance type advertises it.

## Fields & optionality

- `Schema.optionalKey(schema)` → exact optional **property**; the key may be
  absent. **Prefer this for object fields.**
- `Schema.optional(schema)` → the value is `A | undefined`. Use only when the
  value itself should carry `undefined`.

```ts
const Query = Schema.Struct({ search: Schema.optionalKey(Schema.String) });
```

Decoding defaults (the v3 `optionalWith({ default })` replacement):

```ts
Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed("")));      // { default }
Schema.String.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed("")));   // { exact: true, default }
```

Reverse direction: `Schema.requiredKey` makes an `optionalKey`/`optional` field
required; `Schema.required` makes an `optional` field required and drops
`undefined`. Apply across a struct with `struct.mapFields(Struct.map(Schema.requiredKey))`.

## Checks vs refine vs makeFilter

Three distinct tools — pick by intent:

- **Constraints that keep the type** → `.check(...)` with the `is*`
  combinators (all renamed with an `is` prefix in v4, all on `Schema`):

  ```ts
  const nonNegativeInteger = Schema.Number.check(
   Schema.isInt(),
   Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  );
  ```

  Verified `is*` members: `isInt`, `isBetween`, `isGreaterThan`,
  `isGreaterThanOrEqualTo`, `isLessThan`, `isLessThanOrEqualTo`, `isMultipleOf`,
  `isFinite`, `isMinLength`, `isMaxLength`, `isLengthBetween`, `isPattern`,
  `isNonEmpty`, `isUUID`, `isULID`, `isCapitalized`. (`positive`/`negative`/
  `nonNegative`/`nonPositive` were **removed** — compose `isGreaterThan(0)` etc.)

- **Type-narrowing** → `Schema.refine(refinement)` (v3 `filter(refinement)`):

  ```ts
  const someString = Schema.Option(Schema.String).pipe(Schema.refine(Option.isSome));
  ```

- **Inline predicates** → `Schema.check(Schema.makeFilter(pred))` (v3
  `filter(predicate)`). `makeFilter`'s return shape is rich — this is the tool
  for cross-field validation:

  | return | meaning |
  | --- | --- |
  | `undefined` / `true` | success |
  | `false` | generic failure |
  | `string` | failure with that message |
  | `SchemaIssue.Issue` | fully-formed issue |
  | `{ path, issue }` | failure at a nested path |
  | `ReadonlyArray<FilterIssue>` | several failures at once (empty = success) |

  ```ts
  const Signup = Schema.Struct({
   password: Schema.String,
   confirmPassword: Schema.String,
  }).check(
   Schema.makeFilter((o) =>
    o.password === o.confirmPassword
     ? undefined
     : { path: ["confirmPassword"], issue: "passwords must match" },
   ),
  );
  ```

## Unions & literals — prefer tagged

Array forms in v4 (v3 was variadic); single literal stays single-arg:

```ts
Schema.Union([Schema.String, Schema.Number]);
Schema.Literals(["a", "b"]);
Schema.Literal("a");
Schema.Null; // replaces Schema.Literal(null)
```

For domain variants, prefer a **tagged union of `TaggedClass` members** —
`_tag`-based branching is the Effect-idiomatic shape:

```ts
class Created extends Schema.TaggedClass<Created>()("Created", { id: Schema.String }) {}
class Deleted extends Schema.TaggedClass<Deleted>()("Deleted", { id: Schema.String }) {}
const Event = Schema.Union([Created, Deleted]);
```

## Transformations & codecs — the v4 core

Connect one schema's decoded output to another with `Schema.decodeTo(to, transformation)`
(curried, `pipe`-friendly; `encodeTo` for the reverse-reads-clearer direction).
A transformation is a `SchemaTransformation.*` value **or** a `{ decode, encode }`
pair of `SchemaGetter.*` values.

Pure/total transform:

```ts
const BooleanFromString = Schema.Literals(["on", "off"]).pipe(
 Schema.decodeTo(
  Schema.Boolean,
  SchemaTransformation.transform({
   decode: (literal) => literal === "on",
   encode: (bool) => (bool ? "on" : "off"),
  }),
 ),
);
```

Fallible transform — **both spellings are valid in beta.93**; know both so
migration-doc code and our-port code both read cleanly:

```ts
// (a) our ports' spelling — SchemaTransformation.transformOrFail passed positionally
Schema.String.pipe(
 Schema.decodeTo(
  Target,
  SchemaTransformation.transformOrFail({
   decode: (s) => /* Effect.succeed(...) | Effect.fail(new SchemaIssue.InvalidValue(Option.some(s))) */,
   encode: (v) => Effect.succeed(/* … */),
  }),
 ),
);

// (b) the official migration doc's spelling — { decode: SchemaGetter.transformOrFail(...), encode: … }
const NumberFromString = Schema.String.pipe(
 Schema.decodeTo(Schema.Number, {
  decode: SchemaGetter.transformOrFail((s) => {
   const n = Number.parse(s);
   return n === undefined
    ? Effect.fail(new SchemaIssue.InvalidValue(Option.some(s)))
    : Effect.succeed(n);
  }),
  encode: SchemaGetter.String(),
 }),
);
```

Failures come from `effect/SchemaIssue` — `InvalidValue` (ctor), `MissingKey`,
`Composite`. A failed parse throws a `Schema.SchemaError` whose `.issue`/`.cause`
holds a `SchemaIssue`.

### String codecs as class statics (`FromString`)

Give every string-shaped domain class a `FromString` codec so the string is the
encoded form of the *same* schema — round-trips and arbitraries come free:

```ts
static readonly FromString: Schema.Codec<SemVer, string> = Schema.String.pipe(
 Schema.decodeTo(
  SemVer,
  SchemaTransformation.transformOrFail({
   decode: (input: string) => {
    const result = parseVersion(input); // pure internal grammar
    return result.ok
     ? Effect.succeed(result.value) // To["Encoded"]: plain field record
     : Effect.fail(new SchemaIssue.InvalidValue(Option.some(input), { message: /* … */ }));
   },
   encode: (parts) => Effect.succeed(formatVersion(parts)),
  }),
 ),
);
```

- `decode` produces the target schema's **Encoded** form (a plain field
  record); the class schema then validates and instantiates it.
- **When `decode` produces class INSTANCES, not the encoded record, make the
  `decodeTo` target `Schema.instanceOf(Doc)`, not the class schema `Doc`.**
  A document codec whose `decode` calls `Doc.parse(input)` and returns `Doc`
  instances cannot use `Schema.decodeTo(Doc, …)` — the class schema expects the
  encoded struct and the transformation types will not line up. Wrapping the
  target as `Schema.decodeTo(Schema.instanceOf(Doc), …)` types the
  transformation against the instance and typechecks. The common `FromString`
  case above (decode → encoded record, target = the class) is unchanged; this is
  only for codecs that hand back already-constructed instances.
- **The explicit `Schema.Codec<Self, string>` annotation is load-bearing**: a
  static initializer that references its own class (`Schema.decodeTo(SemVer,
  ...)`) otherwise trips TypeScript's circular-inference error. Annotating with
  the instance type (not `typeof SemVer`) breaks the cycle.
- Keep a `parse` static (`Effect.fn("X.parse")`) that raises the concept's own
  `Schema.TaggedErrorClass` with rich payload (`input`, `position`) by calling
  the same internal grammar directly — `SchemaError` never escapes the package,
  and the schema path and the parse path cannot drift because both delegate to
  one implementation.

## Decode/encode: prefer the Effect variants in app code

In Effect/application flows use `Schema.decodeUnknownEffect(S)` /
`Schema.encodeUnknownEffect(S)` — they surface failures through the typed error
channel. Reserve `Schema.decodeUnknownSync(S)` (throws) for a genuine sync
boundary; `decodeUnknownExit` returns an `Exit`. The `*Effect`/`*Exit` naming
replaces v3's `*`/`*Either`.

## Don't duplicate schemas — derive

One logical model, multiple encoded forms: reach for a **transformation**, not a
second schema, when only the *encoding* differs. Derive variants instead of
retyping fields:

- `struct.mapFields(Struct.pick(["a", "b"]))` / `Struct.omit([...])`
- `struct.mapFields(Struct.map(Schema.optionalKey))` for a partial
- `struct.mapFields(Struct.map(Schema.requiredKey))` for the reverse

Duplicate a schema only for a genuine *semantic* difference (creation payload vs
persisted entity; public contract vs internal model; intentional projection) —
not to encode the same data two ways.

## Branded & opaque scalars

For nominal domain scalars that are structurally a primitive but must not be
interchangeable:

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId")); // nominal refinement
// Schema.Opaque — opaque schema-backed type, same runtime shape
```

**A branded scalar that also needs a statics namespace** (first boundary port):
a `const` brand schema and a TS `namespace` of the same name **cannot merge** (a
namespace only merges with a class/function/enum, never a `const`). Attach the
statics with `Object.assign` instead, and keep two typing rules straight:

```ts
// leave the brand const type-inferred — an explicit annotation would name the
// private Schema.filter internals:
const PackageName = Object.assign(
 Schema.String.pipe(Schema.brand("PackageName")),
 { of: (s: string): PackageName => /* … */ } satisfies PackageNameStatics,
);
// type the EXPORTED brand so @public doesn't leak the private brand const:
export type PackageName = string & Brand.Brand<"PackageName">;
```

- Don't annotate the brand `const` — inference keeps the private `Schema.filter`
  type out of the public surface; an explicit annotation drags it in.
- `satisfies` the statics object against an interface so the shape is checked
  without widening.
- Export the type as `string & Brand.Brand<"Name">`, not `typeof PackageName`,
  so the `@public` type is clean.

## Derived tooling — exact names

From any schema (the class included):

- `Schema.toArbitrary(S)` — fast-check generators, honoring `.check(...)` bounds.
- `Schema.toEquivalence(S)` — structural equivalence.
- `Schema.toFormatter(S)` — pretty formatter (v3 `pretty`).
- `Schema.toStandardSchemaV1(S)` — Standard Schema v1.
- `Schema.toJsonSchemaDocument(S)` — JSON Schema. **Not `toJsonSchema`** — that
  export does not exist (`typeof === "undefined"`); reaching for it is a silent
  trap.

## Custom equality: override BOTH symbols

v4 `Equal.equals` is **deep-structural by default** — v3's `Schema.Data` is
removed because you no longer need it for ordinary structural equality. Override
the symbols **only** when equality must *ignore* some fields (our SemVer case:
two versions equal when they differ only in build metadata). And when you do,
override both, because `Equal.equals` fast-paths on hash inequality — overriding
`[Equal.symbol]` alone **silently does nothing** when the default structural
hashes differ:

```ts
[Equal.symbol](that: unknown): boolean {
 return that instanceof SemVer && /* semantic equality, e.g. ignore build */;
}
[Hash.symbol](): number {
 return Hash.string(/* canonical form of ONLY the fields equality uses */);
}
```

Pin the pair with a regression test: two instances that differ only in ignored
fields must be `Equal.equals` AND have identical `Hash.hash`.

## Arbitrary-safe field constraints

`Schema.toArbitrary` derives generators from `.check(...)` constraints, and
`it.effect.prop` accepts the class schema directly as an arbitrary. Two traps:

- **No lookahead in `isPattern` regexes** — fast-check's `stringMatching` throws
  `Assertions of kind Lookahead not implemented yet`. Rewrite
  `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/`.
- **Make the field model canonical or round-trips lie.** If two type-level
  values print to the same string (e.g. prerelease `"7"` vs `7` both print
  `-7`), decode(encode(v)) cannot restore the original. Constrain the schema so
  only the canonical representative is valid (string identifiers must contain a
  non-digit; all-numeric identifiers are numbers).

Then the property test is one honest line of intent:

```ts
it.effect.prop("round-trips decode(encode(v))", [SemVer], ([v]) => /* … */);
```

## Integer fields

`Schema.Number` alone accepts anything numeric. For version-like components:

```ts
const nonNegativeInteger = Schema.Number.check(
 Schema.isInt(),
 Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
```

Match the schema bounds to what your parser enforces (safe integers), or
`make`-constructed values can print strings the parser rejects.

## Watch the import graph when placing statics

A delegating static (`SemVer.diff` → `VersionDiff.between`) is an import edge. If
the target module's fields reference the source class (`VersionDiff.from: SemVer`),
the delegation creates a cycle — `noImportCycles` is an error in this repo.
Prefer one canonical entry point on the concept that owns the result type
(`VersionDiff.between(a, b)`) over convenience mirrors.
