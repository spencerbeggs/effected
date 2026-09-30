# Property testing with `it.effect.prop` and `it.prop`

Loaded from `effect-v4-testing`.

Feed a Schema (or class — the class *is* the schema) directly as an arbitrary.
The engine is core's native **`Arbitrary`**, not
fast-check — there is no `FastCheck` module: both `it.prop` and `it.effect.prop`
compile every input through
`Arbitrary.isArbitrary(input) ? input : Arbitrary.schema(input)`
(`packages/vitest/src/internal/internal.ts:89-96`) and run
`Arbitrary.checkEffect` (`:120`), so inputs may be Schemas, `Arbitrary`
values, or a mix, in the array or the named-record form:

```ts
import { assert, it } from "@effect/vitest";
import { Yaml } from "@effected/yaml";
import { Arbitrary, Effect, Schema } from "effect";

const Sample = Schema.Struct({
  name: Schema.String,
  count: Schema.Int.check(Schema.makeFilter((n) => !Object.is(n, -0))), // Yaml.stringify drops -0's sign
});

it.effect.prop("parse recovers what stringify produced", [Sample], ([value]) =>
  Effect.gen(function* () {
    const text = yield* Yaml.stringify(value);
    assert.deepStrictEqual(yield* Yaml.parse(text), value);
  }),
  { arbitrary: { runs: 200, size: 64 } },
);

const Name = Arbitrary.schema(Schema.Literals(["Ada", "Grace"]));
it.prop("mixed inputs", { name: Name, n: Schema.Int }, ({ name, n }) => typeof name === "string" && Number.isInteger(n));
```

The options bag is **`arbitrary?: Arbitrary.CheckOptions`** on the
`timeout`/`TestOptions` argument (`packages/vitest/src/index.ts:108,161`):
`{ runs, size, maxDiscards, maxShrinks, seed, replay }` (`Arbitrary.ts:195`).
There is **no `fastCheck: { numRuns }` option** — `numRuns` is `runs`, `path` is the
opaque `replay` token, `maxSkipsPerRun` is one absolute `maxDiscards`. A raw
fast-check arbitrary in the inputs is a type error and a runtime failure;
compose an `Arbitrary` instead. The module's surface, the fast-check → native
translation table (`constantFrom` → `Schema.Literals`, `array` →
`Schema.Array(...).check(isBetweenLength)`, `stringMatching` → `isPattern`,
`oneof` over Arbitraries → `flatMap` over a Schema-generated index — there is
**no** `oneof`/`constantFrom`/`array`/`weighted` in the module) and the
declaration-level `toCodecArbitrary` contract live in
`effect-v4-schema/references/11-generation-and-tooling.md`. What follows is
what a probe settled about **this repo's** thirteen migrated property suites:

- **The `size` clamp silently shrinks a domain.** Every unconstrained string
  and array length is generated up to `min(maxLength, max(minLength, size))`
  with `size` defaulting to **10** (`internal/arbitrary/schema.ts:1080-1085`,
  `:1298-1299`; `runner.ts:472,615`), ramping from 0 across the runs. A
  `Schema.String.check(Schema.isMaxLength(40_000))` input never exceeded 10
  characters at the default and reached 40 000 with `arbitrary: { size: 40_000 }`.
  A byte-budget or long-input property that does not pass `size: <cap>`
  tests tiny inputs and greens for the wrong reason (`packages/github/__test__/resources2.test.ts`
  is the worked case). Unbounded `Schema.Int` has magnitude `size²` (±100) —
  bound it with `isBetween` when the property is about a 32-bit domain.
- **A brand whose check is a bare `makeFilter` EXHAUSTS instead of hanging.**
  The engine budgets rejections and fails typed — `SampleError { generated: 0, discards: 101 }`
  in under a millisecond, or `Exhausted` from `it.prop` — and an `optionalKey`
  field of that type is simply never populated, so the property never
  exercises it. Fix the domain, not `maxDiscards`: a `Schema.Literals` of real
  values, or an `arbitraryConstraint` on the filter
  (`packages/lockfiles/__test__/roundtrip.property.test.ts` header is the
  worked case).
- **The generator emits `-0`.** Always for `Schema.Number`/`Finite`, and for
  `Schema.Int` whenever the effective lower bound is `-1` — which an
  **unbounded** `Schema.Int` has during the early small-size runs
  (`internal/arbitrary/model.ts:629`, where a lower bound of `-1` yields the
  range `{ minimum: -0 }`, and `:570`, which returns that bound as-is;
  `checkEffect(Arbitrary.schema(Schema.Int), (n) => !Object.is(n, -0))` is
  Falsified within the first ten runs, and `formatCheckFailure` prints the
  shrunk input as `0`, hiding the sign). Both parsers read `-0` back (`JSON.parse("-0")` and
  `Yaml.parse("-0")` are both `-0`), but both stringifiers drop the sign
  (`JSON.stringify(-0) === "0"`, and `Yaml.stringify(-0)` is `"0\n"`), so a round-trip property
  over serialized numbers excludes it —
  `Schema.Int.check(Schema.makeFilter((n) => !Object.is(n, -0)))` — rather
  than letting `deepStrictEqual` fail on `+0`/`-0`
  (`packages/jsonc/__test__/Jsonc.test.ts`, `packages/yaml/__test__/Yaml.test.ts`).
- **A partial dictionary is a Struct of `optionalKey`.** `Schema.Record(Schema.Literals([...]), V)`
  always emits **every** key (200 samples, key count always 3), and
  `Schema.Array(Schema.Tuple([K, V])).check(Schema.isUniqueKey())` over a
  tiny key domain samples lengths 0-3 but never the *some-keys-present*
  dictionary a lockfile carries. `Schema.Struct({ a: optionalKey(V), b: optionalKey(V) })`
  samples key counts 0, 1, 2 and 3.
- **`isPattern` regexes must be lookaround-free, free of the `i`/`m`/`v`
  flags, and always carry `u`.** The native regexp compiler returns
  `undefined` for lookahead/lookbehind, backreferences and the `i`/`m`/`v`
  flags (`internal/arbitrary/regexp.ts:344,350,832`), and the string node
  then **silently drops the pattern** (`schema.ts:1051-1052`) and filters
  random strings — which exhausts for any selective pattern
  (`/^(?=.*[0-9])[a-f0-9]{8}$/u` and `/^[a-f]{8}$/iu` both died with
  `discards: 201`). `u` is the flag the compiler supports
  (`regexp.ts:835` generates full code points under it, so a negated class
  or `\S` can yield astral characters), and JSON Schema export needs it:
  `isPattern` exports `pattern` only when the flags match `/^[dg]*uy?$/`
  (`Schema.ts:6636`), so a flag-free regex exports a bare
  `{"type":"string"}` while decoding still enforces it. Rewrite
  `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/u`
  (`packages/semver/src/SemVer.ts`, `packages/schema-org/src/NodeRef.ts`). Hostile-unicode input is generated
  as **code points** (`Schema.Array(Schema.Int.check(isBetween({ minimum: 0, maximum: 0x10ffff })))`
  mapped through `String.fromCodePoint`), because the native string
  generator stays in printable ASCII and the module has no
  `fc.string({ unit: "binary" })` equivalent.
- **Derivation composes through `Schema.Union` of `Schema.Class` members, and
  the generated values are REAL class instances** — `instanceof` holds for
  each member and every element is one of them, verified directly against the
  native engine. Code under test that branches on
  `x instanceof StyleVote` takes the real branch. In-repo reference:
  `packages/yaml/__test__/inference.test.ts`.
- **`it.prop` accepts a Schema directly.** Both runners share `makeArbitrary`
  (`internal.ts:92`). Hand-built inputs are `Arbitrary` values, not
  `FastCheck.*` ones.

**Reading a property failure.** `@effect/vitest` dies with
`Arbitrary.formatCheckFailure` (`Arbitrary.ts:367`): runs, shrinks, the
**shrunk input**, the failure and the **replay token**. The vitest-agent
reporter that owns this repo's CLI output compacts that to its first line —
`Property falsified after 33 run(s) and 1 shrink(s)` — and drops the input
and the token (a deliberately falsified control shows it).
The terminal stays the agent reporter's, but
`pnpm exec vitest run --project <p> --coverage.enabled=false --reporter=json --outputFile=<path>`
still writes the full message to the file (`Shrunk input: [5]` /
`Replay: [0,"1",32,3,[1],"ReturnedFalse"]`). Re-run with `arbitrary: { replay }` to reproduce
the shrink path — and pin the counterexample as an ordinary regression test,
because replay tokens are not promised across releases of the unstable module.
