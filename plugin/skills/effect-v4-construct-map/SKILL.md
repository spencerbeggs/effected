---
name: effect-v4-construct-map
description: Use when porting Effect v3 code to Effect v4 or writing new v4 code from v3-era memory — maps removed/renamed v3 constructs (Context.Tag, SortedSet, Hash.cached, Schema variadic unions, check combinators) to their v4 replacements, verified against effect 4.0.0-beta.93. Consult BEFORE reaching for a v3 API name; verify anything not listed against the installed package, not memory.
---

# Effect v3 → v4 construct map

Verified against `effect@4.0.0-beta.93`. v4 betas move fast — when an API is
not listed here, check `node_modules/effect/dist/` for the module and its
`.d.ts` signature before writing code. Never trust v3 muscle memory.

## Removed or renamed modules

| v3 | v4 |
| --- | --- |
| `Context.Tag("id")<Self, Shape>()` | Gone. `Context.Service<Self, Shape>()("id")` — class form; identifier and shape in one place |
| `SortedSet` | **Removed entirely.** Use a sorted `ReadonlyArray` + `Order` (binary-search insert, dedupe on `compare === 0`) or `HashSet` when order is not needed |
| `Hash.cached(this)(h)` | **Removed.** Hash without caching; a cheap canonical form is `Hash.string(canonicalString)` |
| `effect/schema/Check` (guessed name) | Does not exist. Check combinators live on `Schema` itself as `Schema.is*` |

## Changed signatures

| v3 | v4 |
| --- | --- |
| `Schema.Union(A, B)` (variadic) | `Schema.Union([A, B])` (array) |
| `Schema.Literal("a", "b")` (variadic) | `Schema.Literals(["a", "b"])`; `Schema.Literal("a")` stays single |
| `Schema.TaggedClass<Self>()("Tag", fields)` | Same shape, still two-stage |
| `Data.TaggedError("Tag")<Payload>` | `Schema.TaggedErrorClass<Self>()("Tag", fields)` — schema-backed, yieldable, serializable |
| `Option.fromNullable(x)` patterns | Check the exact v4 name/arity; `Option.fromNullishOr` takes ONE argument. When unsure, construct explicitly: `x === undefined ? Option.none() : Option.some(x)` |
| filters via `Schema.filter(...)` | `.check(Schema.isInt(), Schema.isBetween({ minimum, maximum }), Schema.isPattern(regex), ...)` |
| `Effect.either(fx)` / the `Either` module | **`Either` is gone from the common surface.** `Effect.result(fx)` returns `Effect<Result<A, E>>`; branch with `Result.isSuccess` / `Result.isFailure` (from `effect/Result`). In tests, `yield* Effect.result(...)` then assert `result._tag === "Success"`, or use `Effect.flip` to pull the error out |
| `Effect.catchAllDefect(f)` | `Effect.catchDefect(f)` — same shape, renamed |

## Constructor and validation semantics

- **`new X({...})` VALIDATES structurally in v4** (v3's did not). Passing an
  explicit `undefined` for a `Schema.optionalKey` field throws
  `Expected string, got undefined` — a *present* key whose value is
  `undefined` is not the same as an *absent* key. `{ disableChecks: true }`
  does NOT rescue you; it skips `.check(...)` refinements only, not the
  structural parse. `X.make` behaves identically. In engine/hot-path code
  that builds nodes from possibly-absent fields, use conditional spreads:
  `new Node({ offset, length, ...(anchor !== undefined ? { anchor } : {}) })`.
  This bites *pervasively* in v3→v4 ports — v3 engines pass bare
  possibly-undefined fields everywhere (`makeScalar`, `compose*`), and each
  site is a latent runtime throw. Measured `new` overhead of validation is
  ~8%, so keep `new` on hot paths for the ergonomics; just never pass
  explicit `undefined`.
- `X.make(input)` validates only what the field schemas constrain. Bare
  `Schema.Number` fields accept `-1.5`; attach `.check(...)` constraints or
  `make` is a rubber stamp.
- The **type side** of `make` for nested class fields wants class instances
  (`Comparator.make({ operator, version: SemVer.make(parts) })`); the runtime
  coerces plain records, but the types are stricter than the runtime — follow
  the types.
- `Schema.TaggedErrorClass` instances are yieldable
  (`yield* new MyError({...})` fails the effect) and `instanceof Error`.
  A derived `message` getter needs `override`.

## Still true in v4

- `Function.dual(arity, body)` for dual APIs.
- `Effect.fn("name")(function* (...) {...})` for named spans (use at public
  operation boundaries only).
- `Layer.effect(ServiceKey, effect)` / `Layer.succeed` discipline unchanged.
- `Order.make((a, b) => ...)` produces a callable order usable directly as an
  array comparator.

## How to verify quickly

Run from any workspace package that depends on the v4 catalog:

```bash
node --input-type=module -e "
import * as S from 'effect/Schema';
console.log(typeof S.TheApiYouWant);
"
```

One runtime probe beats an hour of type-error archaeology.
