---
name: effect-v4-schema-classes
description: Use when designing an Effect v4 Schema.Class domain model — FromString-style string codecs via decodeTo, custom Equal/Hash semantics, static self-reference typing, and arbitrary-safe field constraints. Covers the traps that only surface at test or property-test time (hash fast-path, lookahead regex, non-canonical field models).
---

# Schema.Class domain-model patterns (Effect v4)

The class IS the schema: one `Schema.Class` carries fields, validation,
methods, statics, and derived tooling (`toArbitrary`, equivalence, JSON
schema). These patterns keep that single artifact sound.

## String codecs as class statics (`FromString`)

Give every string-shaped domain class a `FromString` codec so the string is
the encoded form of the same schema — round-trips and arbitraries come free:

```ts
static readonly FromString: Schema.Codec<SemVer, string> = Schema.String.pipe(
 Schema.decodeTo(
  SemVer,
  SchemaTransformation.transformOrFail({
   decode: (input: string) => {
    const result = parseVersion(input); // pure internal grammar
    return result.ok
     ? Effect.succeed(result.value) // To["Encoded"]: plain field record
     : Effect.fail(new SchemaIssue.InvalidValue(Option.some(input), { message: ... }));
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
  instances cannot use `Schema.decodeTo(Doc, …)` — the class schema expects
  the encoded struct and the transformation types will not line up. Wrapping
  the target as `Schema.decodeTo(Schema.instanceOf(Doc), …)` types the
  transformation against the instance and typechecks. The common `FromString`
  case above (decode → encoded record, target = the class) is unchanged; this
  is only for codecs that hand back already-constructed instances.
- **The explicit `Schema.Codec<Self, string>` annotation is load-bearing**: a
  static initializer that references its own class (`Schema.decodeTo(SemVer,
  ...)`) otherwise trips TypeScript's circular-inference error. Annotating
  with the instance type (not `typeof SemVer`) breaks the cycle.
- Keep a `parse` static (`Effect.fn("X.parse")`) that raises the concept's
  own `Schema.TaggedErrorClass` with rich payload (`input`, `position`) by
  calling the same internal grammar directly — `SchemaError` never escapes
  the package, and the schema path and the parse path cannot drift because
  both delegate to one implementation.

## Custom equality: override BOTH symbols

`Equal.equals` fast-paths on hash inequality. Overriding `[Equal.symbol]`
alone **silently does nothing** when the default structural hashes differ:

```ts
[Equal.symbol](that: unknown): boolean {
 return that instanceof SemVer && /* semantic equality, e.g. ignore build */;
}
[Hash.symbol](): number {
 return Hash.string(/* canonical form of ONLY the fields equality uses */);
}
```

Pin the pair with a regression test: two instances that differ only in
ignored fields must be `Equal.equals` AND have identical `Hash.hash`.

## Arbitrary-safe field constraints

`Schema.toArbitrary` derives generators from `.check(...)` constraints, and
`it.effect.prop` accepts the class schema directly as an arbitrary. Two traps:

- **No lookahead in `isPattern` regexes** — fast-check's `stringMatching`
  throws `Assertions of kind Lookahead not implemented yet`. Rewrite
  `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/`.
- **Make the field model canonical or round-trips lie.** If two type-level
  values print to the same string (e.g. prerelease `"7"` vs `7` both print
  `-7`), decode(encode(v)) cannot restore the original. Constrain the schema
  so only the canonical representative is valid (string identifiers must
  contain a non-digit; all-numeric identifiers are numbers).

Then the property test is one honest line of intent:

```ts
it.effect.prop("round-trips decode(encode(v))", [SemVer], ([v]) => ...);
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

A delegating static (`SemVer.diff` → `VersionDiff.between`) is an import
edge. If the target module's fields reference the source class
(`VersionDiff.from: SemVer`), the delegation creates a cycle —
`noImportCycles` is an error in this repo. Prefer one canonical entry point
on the concept that owns the result type (`VersionDiff.between(a, b)`) over
convenience mirrors.
