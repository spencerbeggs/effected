# Memoization — layers build once, by reference

## Within one graph, and across provides

Within one provided layer graph, the same layer *value* is built exactly
once, however many composites reference it. Across `Effect.provide` calls
the rule depends on nesting: a provide's build adds its `MemoMap` to the
context (`Layer.ts:678`), and a provide running **inside** it forks that
map (`CurrentMemoMap.forkOrCreate`, `Layer.ts:601`), so a nested provide
reuses what the enclosing one built:

```ts
const main = program.pipe(Effect.provide(DbSubsystem), Effect.provide(DbSubsystem));
// Built ONCE — the inner provide forks the outer provide's MemoMap.
```

Provides that are **not** nested — one after another, or siblings under a
common parent — each start their own map and build again (probed: nested
1 build, sequential 2, siblings under one outer provide 2). A warm-up
`Effect.scoped(Layer.build(L))` followed by `program.pipe(Effect.provide(L))`
is two sequential builds.

## Identity is by reference

Identity is **by reference**, and that is the footgun. A function that
*returns* a layer mints a **fresh reference every call**, defeating
memoization and building the underlying resource (pool, HTTP client,
telemetry) more than once:

```ts
// BAD — two distinct references, resource built twice:
const AppLayer = Layer.mergeAll(makeDatabaseLayer(), makeDatabaseLayer());

// GOOD — call once, bind to a const, reuse the reference:
const DatabaseLayer = makeDatabaseLayer();
const AppLayer = Layer.mergeAll(DatabaseLayer, OtherLayer);
```

Probed, counting resource opens: an inline factory call at two
provide sites opened the resource **twice**; the same factory called once and
bound to a `const` opened it **once**. The two-provide dedup is real, but it can
only dedup a reference it can recognize.

**A parameterized layer static is exactly this shape.** `static readonly layer =
(opts) => Layer.effect(...)` is a factory, and every `Svc.layer(opts)` at a
provide site is a fresh reference — the "it's a static, so it must be a
singleton" intuition is false.

## The symptoms

Learn the **symptoms**, because the type system reports nothing and the tests
mostly pass:

- two database connections opened against one file;
- two ledgers / caches / counters, each holding half the writes;
- **a `PubSub` where each subscriber sees only half the events** — the publisher
  and the subscriber resolved *different* instances.

Anything that looks like "state mysteriously split in two" is this bug until
proven otherwise.

## Discipline — bind layers to named constants

Discipline — **bind layers to named constants**:

- Prefer plain named layer `const`s over layer-returning factories.
- Write a layer-returning function only when the layer genuinely depends on
  runtime params — and even then, call it **once** and reuse the result.
- If a subsystem depends on a parameterized layer, **leave that dependency
  unprovided** and supply the concrete layer once **at the edge**. Don't
  call the factory locally inside subsystem wiring — it breaks sharing and
  hides the dep.

Auto-memoization is a safety net for the multi-provide footgun, not a
license to skip composition. Compose explicitly, provide once.

## Opting out

**Opt out** when you deliberately want a fresh build (test isolation,
independent resource pools):

- `Layer.fresh(layer)` — always builds with a fresh memo map, bypassing the
  shared cache. It isolates only where it wraps: composed layers
  (`Layer.provide`, `provideMerge`, `mergeAll`) are memoized by identity too,
  so a composed `const` referenced twice is built once, and a `Layer.fresh`
  dependency **inside** it is shared with it (probed: 1 build, where
  `Layer.mergeAll(composed, Layer.fresh(composed))` builds 2). Wrap the
  composed layer, not its dependency, when each site needs its own copy.
- `Effect.provide(layer, { local: true })` — builds the layer and its
  sublayers from a **local** memo map, isolated from other provides.

## A layer that must be fresh on every provide

**Layers memoize by reference across provides.** When the same layer object
is required at two places in one layer graph — two sibling layers that both
depend on it, a nested `CliRuntime.main` and a test helper, two `it.effect`
cases a `layer()` block shares — Effect builds it **once** and hands the
same built service to every consumer, exactly the sharing that makes a pure
service cheap to depend on repeatedly. A layer holding **per-run mutable
state** — a findings cell, a counter, anything that should start over each
time it is provided — breaks under that memoization: two logically separate
"provides" quietly read and write the one cell the first provide built.

`Layer.fresh(Layer.sync(...))` is the fix: it opts the layer out of
reference memoization, so every site that provides it gets its own build.
`@effected/cli-kit`'s `CliExit.layer` is exactly this shape — a fresh
`MutableRef` cell per provide, so a nested run or a test never inherits a
prior run's exit code.

```ts
import { Context, Effect, Layer } from "effect"

class Counter extends Context.Service<Counter, { readonly next: () => number }>()(
  "edge-cases/Counter",
) {}
class A extends Context.Service<A, { readonly useA: () => number }>()("edge-cases/A") {}
class B extends Context.Service<B, { readonly useB: () => number }>()("edge-cases/B") {}

const makeCounterLayer = (): Layer.Layer<Counter> =>
  Layer.sync(Counter, () => {
    let n = 0
    return { next: () => ++n }
  })

const layerA = (counter: Layer.Layer<Counter>) =>
  Layer.effect(A, Effect.map(Counter, (c) => ({ useA: () => c.next() }))).pipe(Layer.provide(counter))
const layerB = (counter: Layer.Layer<Counter>) =>
  Layer.effect(B, Effect.map(Counter, (c) => ({ useB: () => c.next() }))).pipe(Layer.provide(counter))

const readBoth = (counter: Layer.Layer<Counter>) =>
  Effect.gen(function* () {
    const a = yield* A
    const b = yield* B
    return [a.useA(), b.useB()] as const
  }).pipe(Effect.provide(Layer.mergeAll(layerA(counter), layerB(counter))))

const shared = makeCounterLayer()
console.log("shared, no Layer.fresh:", await Effect.runPromise(readBoth(shared)))

const fresh = Layer.fresh(makeCounterLayer())
console.log("Layer.fresh:", await Effect.runPromise(readBoth(fresh)))
```

Prints `shared, no Layer.fresh: [ 1, 2 ]` then `Layer.fresh: [ 1, 1 ]`. Without
`Layer.fresh`, `A` and `B` share one built `Counter`, so the second read
continues the first's count. With it, each site's `Counter` starts at zero —
the shape a per-run cell needs.
