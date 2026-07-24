---
"@effected/app": minor
---

## Documentation

### Schema: four gaps closed in `effect-v4-schema`

- **`Schema.optional` is not exact-optional.** It is literally `optionalKey(UndefinedOr(self))`, so it yields `field?: T | undefined` and admits `{ field: undefined }` — which silently violates the intended contract in an `exactOptionalPropertyTypes` codebase. `Schema.optionalKey` is the exact-optional form. Includes the mechanism and the compile-level evidence.
- **The reserved `make` collision now has a worked resolution.** A validating `static make(input: string)` is impossible on any class factory (`TS2417`, no overload escape); the kit-wide answer is the `parse` / `parseResult` pair, shown as real code.
- **`transformOrFail`'s callback contract is documented.** Both callbacks must return an `Effect` failing with a `SchemaIssue` — not a `Result`, not a bare value — with the house `InvalidValue(Option.some(value), { message })` failure shape.
- **Nested `Schema.Class` fields are split by self-recursion.** A *self-recursive* field (any AST node type) accepts only real instances and checks them by instance alone; a *foreign* class field accepts a literal, deep-validates it, and hands back a re-constructed value. The two behave nothing alike, and the difference decides whether identity survives construction.

### `@effect/vitest` must be installed by exact version

`effect-v4-testing` previously implied a bare `pnpm add -D @effect/vitest` would resolve the right line. It does not outside a `catalog:effect` workspace: the `latest` dist-tag is the **v3** line (`0.30.0`, peering `effect@^3.22.0`), and `@beta` runs ahead of a pinned catalog. The bare form installs cleanly with no peer warning and fails only at runtime, with an error that never mentions versions. Now leads with the exact-version pin and a resolution table.

### House style gains the `Schema.Class` member-placement rule

Constructors, parsers, decoders and stateless taxonomy are `static`; operations on a decoded instance are instance methods — with the in-kit precedents named.

## Bug Fixes

- **Retracted a false performance claim.** The schema skill warned that node-by-node construction of a recursive `Schema.Class` re-validates its whole subtree, "doubling per level" (2.7 s at depth 20, hanging past 25), and prescribed an `Object.assign(Object.create(Proto), props)` bypass. It does not reproduce: depth 20 measures ~0.1–0.2 ms and stays flat to depth 60. The guidance to add a validation bypass for cost reasons is withdrawn.
- **`Result` is not yieldable** — the idioms skill's note now covers the success case too (`yield* Result.succeed(42)` dies identically), making clear this is "`Result` is not an Effect", not "errors need a bridge". `Effect.fromResult` remains the only bridge; `Result` has no `.asEffect()`.
- Vendored-source references follow the `.repos/effect` rename, and the 16 Schema reference guides now cite the live `Effect-TS/effect` repo instead of the archived `effect-smol`.

## Maintenance

- Skill guidance re-verified against `effect@4.0.0-beta.101`.
