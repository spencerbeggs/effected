# The default runner — what `it.effect` installs, and the shapes that bypass it

Loaded from `effect-v4-testing`. The mechanics behind "Effect programs run
through `it.effect`", and the two shapes that look close to it and are not.

## What `it.effect` installs

- **`it.effect` runs the returned Effect** and provides the default test
  environment — `TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())`
  (`packages/vitest/src/internal/internal.ts:68`), piped through
  `flow(Effect.scoped, Effect.provide(TestEnv))` (`internal.ts:490`). Its type is
  `Tester<R | Scope.Scope>`, so scoped effects (`Effect.acquireRelease`, scoped
  layers) run **directly** under `it.effect`.
- **There is no `it.scoped`** (zero `scoped` matches in
  `packages/vitest/src/index.ts`; the v3→v4 migration guide
  spells the replacement out — `it.scoped(...)` becomes `it.effect(...)`,
  `it.scopedLive(...)` becomes `it.live(...)`). The Tester surface is
  `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop` — **`it.effect.skipIf`
  and `it.effect.runIf` exist and are well-typed** (`packages/vitest/src/index.ts:82-83`);
  reach for them instead of hand-rolling a conditional `describe`.
- **`it.live`** (`Tester<Scope.Scope | R>`) opts into the real `Clock` and live
  runtime services. Use only when a test genuinely needs wall-clock behavior.
- **`it.effect` takes a Vitest timeout as its third argument** —
  `it.effect(name, self, timeout?: number | TestOptions)`. Any real-time elapsed
  assertion above Vitest's 5000ms default is dead code without it.

## Never launder an Effect through `runSync` — not even over a synchronous layer

- **Never** `it("...", () => Effect.runPromise(program))`. Plain `it()` is fine
  only for genuinely non-Effect pure code (`Jsonc.stripComments`, `Yaml.equals`).
- **The rule is UNCONDITIONAL. "But the layer is fully synchronous" is not a
  carve-out.** The tempting shape is a `describe` block with a local
  `const validate = (doc) => Effect.runSync(Effect.provide(program, Svc.layer))`
  helper, justified because the service's implementation happens to be
  synchronous (a `Layer.succeed` over a sync engine such as ajv), often beside
  sibling blocks in the same file that use `layer(...)` + `it.effect`
  correctly. Synchrony is a property of **today's implementation**, never of
  the **contract**: the member's type is `Effect<A, E>`, which permits async,
  and nothing in the type system tells you when that changes. The two costs:
  - Swap one member for an async implementation and every test in the block
    dies at *runtime* with `AsyncFiberError: An asynchronous Effect was
    executed with Effect.runSync` — no type error, no warning, and the blast
    radius is the whole `describe`.
  - A typed failure escapes `runSync` as a **throw** (in v4 the error instance
    itself, `_tag` intact — not a wrapper), so it lands in Vitest's generic
    exception path instead of `Effect.flip` / `Effect.result`, and the test
    asserts on a stack trace instead of the error channel.

  The correct shape costs one line: `layer(Svc.layer)("the shipped engine",
  (it) => { it.effect(…, () => Effect.gen(…)) })` — and it gets you
  `TestClock`/`TestConsole` and layer memoization for free.

## A plain `it()` that returns an Effect never runs

- **Never** `it("...", () => Effect.gen(...))` — the inverse mistake, and
  the worse one. Returning an Effect without running it hands Vitest a
  non-promise it does nothing with: the test reports **green having evaluated
  zero assertions**. The two shapes are inverses and only the first one looks
  wrong:

  | shape | runs? | symptom |
  | --- | --- | --- |
  | `it(..., () => Effect.runPromise(p))` | yes | correct result, execution laundered |
  | `it(..., () => p)` | **no** | always green, no assertion ever evaluated |

  The fix in both directions is `it.effect`. The shape passes review easily,
  and a vacuous test is then cited as proof of the very behaviour it fails to
  pin: a false green does not merely miss a regression, it gets used as
  evidence. The shape is greppable, so it belongs in a structural check (the
  skill's `structural-checks.md` reference covers writing one).
- **Never launder an Effect into a fixture with `Effect.runSync`.** If a test
  input comes from an Effect (a parse, a decode), the test *is* an `it.effect`
  and you `yield*` it; if you only need a domain value, build it with `X.make`.
- **`yield* import(...)` breaks** — it throws `(intermediate value) is not
  iterable`, naming neither the import nor the yield. A dynamic import inside
  `Effect.gen` is `yield* Effect.promise(() => import("./thing.js"))`; a bulk
  `await` → `yield*` rewrite produces the broken form mechanically.
