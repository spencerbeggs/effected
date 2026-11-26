---
name: effect-v4-services-layers
description: Use when defining Effect v4 services or wiring Layers — the `Context.Service` class form (type params first, then the id), Layer construction (succeed/effect, scoped is gone), composition (mergeAll vs provide vs provideMerge), providing once at the boundary, and the memoization discipline that keeps a db pool or HTTP client from being built twice. Consult before reaching for any service or layer name you have not verified.
---

# Services & Layers (Effect v4)

**API surface** — existence, signatures and the source line citations —
verified by reading `packages/effect/src`. The **behavioural** claims (the
memoize-by-reference resource counts, the temporal-dead-zone results, the
sync-facade and requirement-union notes) were probed once; spot-check one
against a control before leaning on it for something load-bearing.

A service is a typed key into the runtime's context; a layer is the recipe that
builds it. Get three things right — the one service form, provide-once
composition, and memoization by reference — and the wiring stays honest and
cheap.

**Look it up first.** Before you declare a service, check that core does not
already declare the contract (`FileSystem`, `Path`, `HttpClient`,
`ChildProcessSpawner`, `Stdio`, the `effect/crypto` families) in
[effect-v4-module-index](../effect-v4-module-index/SKILL.md), and that the kit
does not already ship it with a test layer:
`grep -ri "<intent words>" "${CLAUDE_PLUGIN_ROOT}/skills/effected-packages/references/constructs/"`.
A contract core declares is required in `R`, never re-declared. Settle whether
a name exists with
[effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md).

## One service form: `Context.Service`

`Context.Tag`, `Context.GenericTag`, `Effect.Tag`, and `Effect.Service` are
**all gone** — every service is `Context.Service`, type params first, then the
id string (there is no `ServiceMap.ts`; the module is `Context.ts`):

```ts
import { Context, Effect, Layer } from "effect"

class Database extends Context.Service<Database, {
 readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}
```

That form, with **no `make` option**, is the **contract-only** service: it
bakes in no default impl and has no `.layer` to inherit, so wire it with a
separate `Layer.succeed(Database, { query: … })` bound to a named `const`. Reach
for it when the implementation is supplied at the edge or differs per
environment, or when you want the contract stated before the code. When the
impl is small and owned by the service, use the **shape-inferred `make` form**:

```ts
class UserRepo extends Context.Service<UserRepo>()("UserRepo", {
 make: Effect.gen(function* () {
  const config = yield* Config;
  return { getById: (id: string) => Effect.succeed({ id, from: config.url }) };
 }),
}) {
 static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(ConfigLayer));
}
```

- **`make` does NOT auto-generate a layer** — there is no `.Default`; build the
  layer yourself, as above.
- **There is no `dependencies` option** — wire a service's needs with
  `Layer.provide`.
- **Tags are Effects.** `Context.Key<Identifier, Shape> extends
  Effect<Shape, never, Identifier>` (`Context.ts:68`), so `yield* Database` and
  `Effect.flatMap(Database, (db) => …)` work, and there is no `.asEffect()` on a
  service — calling it is a type error.
- **The class's instance type is not the shape.** Name the shape a factory
  returns with `Context.Service.Shape<typeof Svc>` (or `(typeof Svc)["Service"]`);
  annotating with the class name fails with TS2353.
- **A parameter typed `Context.Key<I, Shape>` accepts a key over a wider
  shape**, so the consumer's `yield*` reads members the layer never supplied.

Before you write a function that returns a service implementation or takes a
consumer's key, load [service-shape-types.md](./references/service-shape-types.md):
it has the shape helper, the pin that refuses a wider key, and the accessor
rules.

## Access a service: prefer `yield*`

`yield*` on the class keeps the dependency **explicit in the effect's `R`**:

```ts
const program = Effect.gen(function* () {
 const db = yield* Database;
 return yield* db.query("SELECT 1");
});
```

`Database.use(fn)` / `Database.useSync(fn)` are the only accessors — there is no
per-method proxy, because one would erase generics. Use them sparingly: they
hide which dependency a call site pulled. For a config knob or feature flag
with a default, use `Context.Reference<T>(id, { defaultValue: () => ... })`
instead of a service.

## Layers: build, compose, provide once

`Layer<ROut, E, RIn>` — `ROut` services produced, `E` construction failures,
`RIn` dependencies required to build.

- **`Layer.succeed(Service)(impl)`** — a pure, already-built value.
- **`Layer.effect(Service)(effect)`** — effectful construction that may depend
  on other services **and/or own a scoped resource**. It strips `Scope` from
  `R`, which is why there is **no `Layer.scoped`**: `Layer.effect` over
  `Effect.acquireRelease` *is* the scoped constructor. Both are dual
  (`Layer.effect(this, this.make)` works).

```ts
const DatabaseLayer = Layer.effect(Database)(
 Effect.gen(function* () {
  const config = yield* Config;
  const pool = yield* Effect.acquireRelease(openPool(config.url), (p) => p.close());
  return { query: (sql) => pool.run(sql) };
 }),
);
```

- **In a layer static, refer to the service as `this`, and read a module-local
  `make` through an arrow** (`Effect.map(Dep, (dep) => make(dep))`). Naming the
  class from a `const`-bound class expression, or passing a `make` declared
  below the class, **throws at import time while typechecking clean**, and the
  only signal is vitest reporting `0 tests passed`.
- **Resolve a dependency in `make` only when it is stable.** A dependency the
  caller is meant to vary is read per call, or `Effect.provideService` around
  the call silently changes nothing.
- **Name the primary layer `layer`**, never `Default` or `Live`; variants take
  suffixes (`layerTest`). `Default` is right only for the `index.ts` composite
  that merges two concept modules, which lives there to avoid an import cycle.

Before you write a layer static, a `make` that yields a dependency, or a
composite layer, load
[layer-statics-and-construction.md](./references/layer-statics-and-construction.md):
the import-time throw it prevents is a false green, not a red test.

**A layer-family static belongs to the module that owns the dependency it
needs**, not the module that declares the service, and is named for its variant
(`clientLayer`). **A swappable contract** — an implementation that is a policy
choice — gets **no ambient default** in the composite (`Layer.mergeAll` is
last-wins, so a merged default silently beats the consumer's override), and
ships every implementation **as a value as well as a layer**. Before you place
a layer static or design a contract with several implementations, load
[service-design.md](./references/service-design.md).

### Composition operators

| Operator | Feeds deps? | Keeps dep outputs? | Use for |
| --- | --- | --- | --- |
| `Layer.mergeAll(a, b, …)` | **no** | — (side by side) | combine outputs of independent layers |
| `Layer.provide(target, deps)` | yes | **no** — only `target` | hide construction deps behind a narrow public layer |
| `Layer.provideMerge(target, deps)` | yes | **yes** — target + deps | assemble larger app layers where downstream still needs the deps |

> **Trap:** `Layer.mergeAll(ConfigLayer, DatabaseLayer)` does **not** satisfy
> `DatabaseLayer`'s need for `Config` — merge only places them side by side.
> Use `provide` / `provideMerge` to actually feed a dependency.

**Compose subsystems locally, assemble one app layer, `Effect.provide` once at
the boundary:**

```ts
const DbSubsystem = Layer.provide(DatabaseLayer, ConfigLayer);
const AppLayer = Layer.mergeAll(DbSubsystem, HttpLayer).pipe(Layer.provide(Telemetry));

Effect.runPromise(program.pipe(Effect.provide(AppLayer))); // provide at the OUTERMOST edge
```

Business logic *requires* services; composition happens in layers;
`Effect.provide` happens at the app / test entry point. `Effect.provide` deep
inside business logic hides wiring, blocks test substitution and spawns many
small runtimes. Several entry points (HTTP handlers, consumers, cron) share one
`ManagedRuntime.make(AppLayer)`. `Layer.Success<typeof L>` and
`Layer.Error<typeof L>` are top-level type helpers.

**Collecting values generic in a requirements union pins the type from the
first element** and rejects the wider ones. Before you build an array of
resolvers or layers feeding one generic parameter, load
[edge-cases.md](./references/edge-cases.md) and annotate the collection where it
is built.

## Platform capabilities: require in R, never own a backend

Core **declares** `FileSystem`, `Path`, `Terminal`, `Stdio` and
`ChildProcessSpawner`; `@effect/platform-*` **implements** them
(`NodeServices.layer` provides all five, and crypto comes from `NodeCrypto`
layers or `Digest.layerWebCrypto`, not from `NodeServices.layer`).

- **A library requires the core-declared service in its `R`**; the application
  provides the platform layer once at the edge. Requiring-in-R adds no
  dependency edge.
- **A `@effect/platform-*` dependency edge is different** — it drags the
  platform into every consumer's tree. Platform packages belong in
  devDependencies for integration tests, and in dependencies only for
  applications and app-edge packages.
- **A direct `node:` import in library code is a code smell**, outside a
  documented Node-only overlay.

Before you design a service or seam over IO, a subprocess or crypto, load
[platform-capabilities.md](./references/platform-capabilities.md) and grep core
for the contract: a hand-rolled parallel vocabulary is the failure this
prevents.

## Sync facades: per-call service values, not layers

A synchronous escape hatch over consumer-supplied ops (build-tool plugin hooks,
config-time contexts) takes service **values** provided per call with
`Effect.provideService` — never a Layer, so consecutive calls carrying different
ops cannot hit the memoization trap below. Before you write one, load
[edge-cases.md](./references/edge-cases.md) for the `FileSystem.makeNoop` /
hand-rolled-`Path` recipe and the honest `runSyncExit` unwrap.

## Memoization: layers build once, by reference

Within one provided graph, the same layer *value* is built exactly once; a
provide **nested** inside another reuses what the outer one built, while
sequential or sibling provides each build again. Identity is **by reference**:
a function that *returns* a layer mints a fresh reference every call and builds
the resource again.

```ts
// BAD — two distinct references, resource built twice:
const AppLayer = Layer.mergeAll(makeDatabaseLayer(), makeDatabaseLayer());

// GOOD — call once, bind to a const, reuse the reference:
const DatabaseLayer = makeDatabaseLayer();
const AppLayer = Layer.mergeAll(DatabaseLayer, OtherLayer);
```

- **A parameterized layer static (`Svc.layer(opts)`) is a factory**, so every
  call site is a fresh reference.
- **The symptoms are silent:** two connections to one file, two caches each
  holding half the writes, a `PubSub` whose subscriber sees half the events.
  "State mysteriously split in two" is this bug until proven otherwise.
- **Bind layers to named constants**, and leave a parameterized dependency
  unprovided inside subsystem wiring so the edge supplies it once.
- **Opt out deliberately** with `Layer.fresh(layer)` (wrap the composed layer,
  not its dependency) or `Effect.provide(layer, { local: true })`.

Before you write a layer-returning function, provide a layer twice, or hold
per-run state in a layer, load [memoization.md](./references/memoization.md):
it has the nesting rule, the probes and the `Layer.fresh` worked example.

**Two resolved copies of one package are two distinct tag identities**, and
the failure reads as "service not provided" in a graph that visibly provides
it. When you see that, load [edge-cases.md](./references/edge-cases.md) before
hunting a signature change: `pnpm why @effected/<pkg>` and a grep for the
fully-qualified tag id settle it.

## Test layers

Swap the layer, not the code: production provides `Database.layer`, tests
provide a fake at the same boundary. `Layer.succeed(Service)({ ... })` is a full
fake; `Layer.mock(Service, { ... })` is a **partial** one, where an omitted
effect-returning member fails loudly with an unimplemented defect:

```ts
const DatabaseTest = Layer.mock(Database, {
 query: (sql) => Effect.succeed(`mocked ${sql}`),
});
```

**`Layer.mock`'s optionality covers only effect-returning members**: one plain
member (a sync function, a data property) is required in every mock. **So a
service shape carries no non-effectful members** — move a pure helper to a
static or a plain function; never wrap it in `Effect.succeed` to comply. The
one exception is a shape that is *entirely* one immutable value, whose double
is `Layer.succeed`. Keep test wiring close to the production composition: the
Live/Test difference is one swapped layer at the edge, nothing deeper.
**Keep `Function.dual` off service shapes**: every override
must then satisfy both overloads. Before you add a member to a service shape,
load [service-design.md](./references/service-design.md): one plain member
breaks every existing `Layer.mock` call site, far from the cause.

## Additional resources

- [service-shape-types.md](./references/service-shape-types.md) — `Context.Service.Shape`, the indexed `["Service"]` form, why the class instance type is not the shape, pinning a consumer's key, `use`/`useSync`, and the class as an Effect. Load when: a factory returns a service implementation, a parameter takes a consumer's key, or TS2353 names a service class.
- [layer-statics-and-construction.md](./references/layer-statics-and-construction.md) — the `this` rule and the two import-time TDZ throws, resolving a dependency once versus per call, layer naming, where a composite lives, and the top-level type helpers. Load when: writing a `layer` static or a `make`, or a suite reports `0 tests passed` after a layer change.
- [service-design.md](./references/service-design.md) — `Layer.mock`'s `PartialEffectful` split and the no-plain-members rule, `dual` on pure classes, the value-only service, layer statics in the dependency's module, and swappable contracts. Load when: designing a service shape, adding a member to one, or a contract has several implementations.
- [memoization.md](./references/memoization.md) — the `MemoMap` nesting rule, the resource-count probes, the symptoms, the discipline, and `Layer.fresh` with a per-run cell worked through. Load when: a resource is built twice, state splits in two, or a layer holds per-run state.
- [platform-capabilities.md](./references/platform-capabilities.md) — which contracts core declares, what `NodeServices.layer` provides, the `@stability unstable` note, and the require-in-R rules. Load when: a library needs IO, a subprocess, a terminal or crypto.
- [edge-cases.md](./references/edge-cases.md) — split graphs and counting copies in a bundle, sync facades, heterogeneous requirement unions, and a key over a wider shape with the `NoInfer` form. Load when: "service not provided" in a graph that provides it, a sync facade, a collection of generic values, or a factory that takes a consumer's key.
