# Schema house style — worked patterns

The `@effected` house patterns for Effect v4 `Schema`: the opinionated defaults
and the traps that only surface at test or property-test time. This file is
**Schema-specific**; the cross-cutting house style — module layout, naming,
error taxonomy, TSDoc habits, layer conventions, test organization — is the
`effect-v4-house-style` skill, which links back here for Schema depth. This is the depth
behind the **Do this, not this** rules in the `effect-v4-schema` `SKILL.md` — read
those for the at-a-glance directives, come here for the worked examples and the
reasoning.

The class IS the schema: one `Schema.Class` carries fields, validation, methods,
statics, and derived tooling (`toArbitrary`, `toEquivalence`,
`toJsonSchemaDocument`) in a single artifact. These patterns keep that artifact
idiomatic and sound. The API surface below — every `Schema.*`,
`SchemaTransformation.*`, `SchemaGetter.*` and `SchemaIssue.*` name it asserts,
and every `file:line` citation — is verified against `effect@4.0.0-rc.109`.
Individual runtime-behaviour claims carry their own probe stamps inline; where a
stamp names an older beta, that claim was **not** re-run at rc.109 and the
stamp is the honest one. v4 betas move fast, so probe anything not shown here
before writing it
(`node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)"`).
For a v3→v4 name lookup, see `effect-v4-construct-map`; for the canonical
upstream detail on any construct, see the vendored `references/` in this skill.

## Class vs Struct: the first decision

The guide's headline rule — reach for a **named class** for anything real, and
`Struct` only for throwaway inline shapes:

- reusable named model → `Schema.Class`
- reusable tagged-union member → `Schema.TaggedClass`
- reusable error payload → `Schema.TaggedError`
- small local/anonymous object shape → `Schema.Struct`

(beta.102–105 renamed `Schema.TaggedErrorClass` back to `Schema.TaggedError`,
same curried call shape — earlier-v4 code using the `*Class` name fails with
"TaggedErrorClass is not a function".)

```ts
export class User extends Schema.Class<User>("User")({
 id: Schema.String,
 name: Schema.String,
}) {}

class Circle extends Schema.TaggedClass<Circle>()("Circle", {
 radius: Schema.Number,
}) {}

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
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
prototype, so it *runs* — re-confirmed at beta.107, `typeof instance.pipe ===
"function"` — but tsgo rejects instance `.pipe(...)`. (The runtime half is
re-verified; the type-level rejection is a compile-time claim that was **not**
re-probed for beta.107.) If you want
pipeable instances — e.g. to call a dual-signature `Function.dual` static
pipeably (`node.pipe(Node.move(2))`) — retain the manual `Pipeable` overload
block on the class (the `pipe(...args) { return pipeArguments(this, args) }`
member) so the instance type advertises it.

### `disableChecks` skips checks, not validation — and buys no speed

`MakeOptions.disableChecks` reads like an escape hatch from validation. Its own
docstring says "skip validation when you trust the data" (`Schema.ts:108`) and
"skips constructor validation" (`Schema.ts:14265`). Both are misleading, and the
vendored cluster code leans on it as the trusted-construction idiom
(`unstable/cluster/EntityAddress.ts:93`, `RunnerAddress.ts:112`, `Runner.ts:129` —
all three still exact at rc.109), so it looks blessed. What it actually does —
originally probed against `effect@4.0.0-beta.97`, every row re-probed unchanged
at `effect@4.0.0-beta.107`:

| Passing `{ disableChecks: true }` | Effect |
| --- | --- |
| a failing `.check(...)` filter | **skipped** — the value is accepted |
| a *type* error (`n: "nope"` where `n` is `Schema.Number`) | **still throws** `Expected number, got "nope"` |
| the structural re-parse | **still runs** — it is not a fast path |

It gates exactly the check phase (`SchemaParser.ts:1110,1136`; `SchemaAST.ts:1424`,
`:1550`, `:1606` — all five still exact at rc.109) and nothing else. Citation
trap: the old `SchemaAST.ts:3527` pointer is stale and has drifted twice since;
it is not a check gate, so re-derive it from `grep -n disableChecks` rather than
trusting any absolute line for it.

So it is a *semantic* switch for trusted data, never a *performance* one: at
beta.107 a depth-20 recursive build measures 0.58 ms with `disableChecks: true`
against 0.04 ms without it — both JIT noise, and neither anywhere near the
seconds-scale figures this file used to quote.

### Recursive `Schema.Class` construction is LINEAR — the exponential claim is retracted

**Cost trap: this section asserted the opposite through beta.101, with a table of
seconds-scale timings.** It does not reproduce. Re-probed at
`effect@4.0.0-beta.107`, a left-spine recursive `Schema.Class` tree built
node-by-node is **flat and sub-millisecond at every depth**:

| Depth | `new Node` | `Node.make` | `TNode.make` |
| --- | --- | --- | --- |
| 10 | 0.46 ms | 0.08 ms | 0.31 ms |
| 20 | 0.04 ms | 0.05 ms | 0.05 ms |
| 40 | 0.09 ms | 0.07 ms | 0.11 ms |
| 60 | 0.13 ms | 0.15 ms | 0.15 ms |

The depth-20 row is four orders of magnitude off the retracted `5906.0 ms`. The
probe carried a control that genuinely does 2^d work (3.91 ms at d=20, 51.10 ms
at d=24), so the harness could see exponential cost and did not; and a control
proving `make` still rejects a bad field, so construction was doing real work.
Flat and broad shapes were never in doubt and remain linear.

**So do not add a validation bypass for cost reasons.** The
`Object.assign(Object.create(Proto), props)` recipe this section used to
prescribe is no longer justified by performance. Where such a bypass already
exists (`@effected/jsonc`'s `makeNodeUnsafe`) it buys trusted-path construction,
nothing more — and note that at beta.107 a nested class field accepts a plain
literal in both the foreign and self-recursive cases, so even that motivation is
weaker than it was (see the nested-field table in `SKILL.md`).

If you do keep such a bypass, two corrections to the old recipe:

- **`Data.Class`'s constructor is no longer `Object.assign`.** At
  `Data.ts:48-56` it is `super(); InternalRecord.assignProperties(this, props)`,
  and `assignProperties` (`internal/record.ts:16`) copies own enumerable keys
  *but defines `__proto__` as a plain data property* instead of invoking the
  prototype setter. A raw `Object.assign` bypass is therefore **not** an exact
  reproduction any more: it is a prototype-pollution hole on attacker-shaped
  props. Citation trap: the old `Data.ts:57` / "reproduces it exactly" pairing
  was true of an earlier v4 beta and is not true at rc.109 (`Data.ts:48-56` and
  `internal/record.ts:16` both still exact).
- **`TaggedClass` still needs `_tag` written by hand.** The constructor
  synthesizes it; a property copy does not. Omit it and `_tag === undefined`, so
  `Equal.equals` is `false` and every `_tag` match falls through. Pass
  `{ _tag: "TNode", ...props }`.

*Evidence: runtime probe from `packages/semver` against the installed beta,
`resolved effect: 4.0.0-beta.107`, Node 26, left-spine build per depth, with the
two controls described above. Supersedes both the beta.97 and beta.101 tables.*

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
  `isNonEmpty`, `isUUID`, `isULID`, `isCapitalized` — all sixteen re-verified
  present at rc.109. (`positive`/`negative`/`nonNegative`/`nonPositive` were
  **removed** and are still `undefined` — compose `isGreaterThan(0)` etc. The v3
  `Schema.filter` is likewise `undefined`.)
  Match the bounds to what your parser enforces (safe integers), or a
  `make`-constructed value can print a string the parser then rejects.

- **Type-narrowing** → `Schema.refine(refinement)` (v3 `filter(refinement)`):

  ```ts
  const someString = Schema.Option(Schema.String).pipe(Schema.refine(Option.isSome));
  ```

- **Inline predicates** → `Schema.check(Schema.makeFilter(pred))` (v3
  `filter(predicate)`; `Schema.ts:6584`). `makeFilter`'s return shape is rich —
  this is the tool for cross-field validation:

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

  **Annotation trap: the message annotation the default formatter reads is
  `expected`, not `title`.** `makeFilter`'s second argument is an
  `Annotations.Filter`, and the formatter's `formatCheck` reads
  `check.annotations?.expected`, falling back to the literal string `<filter>`
  (`SchemaIssue.ts:1099-1104`, still exact at rc.109). Probed at beta.107:

  ```text
  makeFilter(pred, { title: "a === b" })     -> "Expected <filter>"   <-- the trap
  makeFilter(pred, { expected: "a === b" })  -> "Expected a === b"
  makeFilter(pred)                           -> "Expected <filter>"
  ```

  So `title` is not wrong, it is merely invisible to error output — a
  cross-field check annotated only with `title` reports an anonymous failure.
  Returning a `string` from the predicate is the other way to get a real
  message, and it needs no annotation at all.

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

Fallible transform — **both spellings are still valid at rc.109**
(`SchemaTransformation.transformOrFail` at `SchemaTransformation.ts:286`,
`SchemaGetter.transformOrFail` at `SchemaGetter.ts:561`, and `SchemaGetter.String`);
know both so
migration-doc code and our-port code both read cleanly:

```ts
// (a) our ports' spelling — SchemaTransformation.transformOrFail passed positionally
Schema.String.pipe(
 Schema.decodeTo(
  Target,
  SchemaTransformation.transformOrFail({
   decode: (s) => /* Effect.succeed(...) | Effect.fail(new SchemaIssue.InvalidValue({ message: "…" }, s)) */,
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
    ? Effect.fail(new SchemaIssue.InvalidValue({ message: "not a number" }, s))
    : Effect.succeed(n);
  }),
  encode: SchemaGetter.String(),
 }),
);
```

Failures come from `effect/SchemaIssue` — `InvalidValue` (ctor), `MissingKey`,
`Composite`. Signature trap: since beta.102–105 `InvalidValue` is
`(annotations?, input?, options?)` (`SchemaIssue.ts:572`, still exact at rc.109) — the earlier v4 shape
`new SchemaIssue.InvalidValue(Option.some(s), { message })` no longer
type-checks (the `Option` wrapper is gone, the argument order flipped, and the
input is retained only under `reportInput: true`). A failed
`decodeUnknownSync` parse throws a `Schema.SchemaError` whose `.issue` holds the
`SchemaIssue` and whose `.message` renders it via the default formatter; the
throwing **constructor/adapter** paths (`X.make`, class `new`, `Schema.asserts`,
`SchemaParser`'s sync/promise adapters) instead throw a plain `Error` with the
generic message `"Schema validation failed"` and the issue on `.cause` — format
it with `SchemaIssue.makeFormatterDefault()(error.cause)` (probed beta.105,
re-probed unchanged at beta.107: `X.make` throws a plain `Error` whose
`.message` is exactly `"Schema validation failed"`, while `decodeUnknownSync`
throws a `SchemaError` whose `.message` is formatted and whose `.issue` is
structured).

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
     : Effect.fail(new SchemaIssue.InvalidValue({ message: /* … */ }, input));
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
  `Schema.TaggedError` with rich payload (`input`, `position`) by calling
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

**Export the branded type as `string & Brand.Brand<"Name">`, not `typeof X.Type`
— for EVERY exported brand**, whether or not it carries a statics namespace. Both
forms resolve to the same type, but `typeof X.Type` reads as an opaque alias on
the public surface while the explicit `string & Brand.Brand<"Name">` is
self-documenting. The `"Name"` string must match the schema's `Schema.brand("Name")`
literal exactly. (The statics-namespace case below is one instance of this rule,
not the only one it applies to.)

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

## Watch the import graph when placing statics

A delegating static (`SemVer.diff` → `VersionDiff.between`) is an import edge. If
the target module's fields reference the source class (`VersionDiff.from: SemVer`),
the delegation creates a cycle — `noImportCycles` is an error in this repo.
Prefer one canonical entry point on the concept that owns the result type
(`VersionDiff.between(a, b)`) over convenience mirrors.
