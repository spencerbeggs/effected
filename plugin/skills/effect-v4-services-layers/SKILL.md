---
name: effect-v4-services-layers
description: Use when defining Effect v4 services or wiring Layers — the `Context.Service` class form (type params first, then the id), Layer construction (succeed/effect, scoped is gone), composition (mergeAll vs provide vs provideMerge), providing once at the boundary, and the memoization discipline that keeps a db pool or HTTP client from being built twice. Consult before reaching for any v3 name; see effect-v4-construct-map for the v3→v4 lookup.
---

# Services & Layers (Effect v4)

Verified against `effect@4.0.0-beta.94`. A service is a typed key into the
runtime's context; a layer is the recipe that builds it. Get three things
right — the one service form, provide-once composition, and memoization by
reference — and the wiring stays honest and cheap. For the v3→v4 name
lookup (what a construct *was* called), see `effect-v4-construct-map`.

## One service form: `Context.Service`

`Context.Tag`, `Context.GenericTag`, `Effect.Tag`, and `Effect.Service` are
**all gone** — every service collapses to `Context.Service`. The class form
is preferred; the id and shape live in one place:

```ts
import { Context, Effect, Layer } from "effect"

class Database extends Context.Service<Database, {
 readonly query: (sql: string) => Effect.Effect<string>
}>()("Database") {}
```

Argument order differs from v3: **type params first** via
`Context.Service<Self, Shape>()`, **then** the id string via `("Database")`.
(v3 was `Context.Tag("Database")<Self, Shape>()` — the id moved to the end.)

The `Database` form above — `Context.Service<Self, Shape>()("id")` with **no
`make` option** — is the **contract-only** service: it declares a shape but
bakes in no default impl. There is no `.layer` to inherit; wire it with a
separate `Layer.succeed(Database, { query: … })` bound to a named `const` (first
boundary port). Reach for it when the implementation is supplied at the edge (or
differs per environment) rather than owned by the service.

**Shape-inferred `make` form** — implementation and API stay together, TS
derives the shape. Prefer it when the impl is small; prefer the explicit
generic shape when you want the contract stated before the code:

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

Two traps carried over from v3's `Effect.Service`:

- `make` stores the constructor effect but does **NOT** auto-generate a
  layer — there is no `.Default`. Build the layer yourself (above).
- There is **no `dependencies` option**. A service's needs are wired with
  `Layer.provide`, not declared on the service.

## Access a service: prefer `yield*`

`yield*` on the class pulls the implementation and leaves the dependency
**explicit in the effect's `R`**, where the type system tracks it:

```ts
const program = Effect.gen(function* () {
 const db = yield* Database;
 return yield* db.query("SELECT 1");
});
```

`use` / `useSync` are static accessors (they replace v3's removed proxy
accessors), but reach for them sparingly — they hide *which* dependency you
pulled at the call site, making it easy to leak a service dep into a return
value:

```ts
Database.use((db) => db.query("SELECT 1")); // Effect<string, never, Database>
Config.useSync((c) => c.url);               // pure callback ⇒ Effect<string, never, Config>
```

`use` takes an effectful callback and returns `Effect<A, E, R | Self>`;
`useSync` takes a **pure** callback and returns `Effect<A, never, Self>` (it just
lets the accessor body be synchronous — both still return an `Effect`). The v3
proxy accessors weren't merely renamed; they were removed because the mapped-type
proxy **erased generics** — a `get<T>(key): Effect<T>` collapsed to
`Effect<unknown>` and overloads were lost. `use`/`useSync` preserve the real
method signatures, which is the other reason to prefer them (or `yield*`) over
reaching for a v3-style accessor.

For a config knob / feature flag with a default (not a full API), use
`Context.Reference<T>(id, { defaultValue: () => ... })` instead of a
service.

## Layers: build, compose, provide once

`Layer<ROut, E, RIn>` — `ROut` services produced, `E` construction
failures, `RIn` dependencies required to build.

- **`Layer.succeed(Service)(impl)`** — a pure, already-built value; no deps,
  no scope.
- **`Layer.effect(Service)(effect)`** — effectful construction that may
  depend on other services **and/or own a scoped resource** (db pool,
  socket, worker). Its return type is `Layer<I, E, Exclude<R, Scope>>`: it
  strips `Scope` from `R`. That is exactly why **`Layer.scoped` is gone** —
  `Layer.effect` over an `Effect.acquireRelease` effect *is* the scoped
  constructor:

```ts
const DatabaseLayer = Layer.effect(Database)(
 Effect.gen(function* () {
  const config = yield* Config;
  const pool = yield* Effect.acquireRelease(
   openPool(config.url),
   (p) => p.close(),
  );
  return { query: (sql) => pool.run(sql) };
 }),
);
```

`Layer.succeed` and `Layer.effect` are **dual**: the curried
`Layer.effect(Service)(effect)` is primary, but the data-first
`Layer.effect(Service, effect)` overload also works (handy for
`Layer.effect(this, this.make)`). Both compile.

### In a layer static, refer to the service as `this`

A `layer` static that names its own class is fine **when the service is a class
declaration** — `export class Db extends Context.Service...()` initializes the
class's inner binding before static initializers run, so `Layer.succeed(Db, …)`
inside `Db`'s own body resolves.

It is a **temporal dead zone** when the service is a class **expression bound to
a `const`**, because then there is no inner binding and the name resolves to the
outer `const`, which is still uninitialized while the class body evaluates:

```ts
// THROWS at import time: "Cannot access 'BunResolver' before initialization"
export const BunResolver = class extends Context.Service()("BunResolver", {}) {
 static layer = mk(BunResolver, …);   // ← outer const, still in TDZ
};

// Fine — `this` is the class, always:
export const BunResolver = class extends Context.Service()("BunResolver", {}) {
 static layer = mk(this, …);
};
```

Probed on beta.94: the class-expression form throws, the `this` form does not,
and the class-*declaration* form does not either.

**Write `this` unconditionally.** It is correct in both forms, so it costs
nothing and removes the whole question — and the failure it prevents is a
false green:

> The module throws **at import time** while **typechecking completely clean**.
> The only signal is vitest reporting **`0 tests passed` with exit 0** for every
> file that imports it. A suite that collects zero tests is not a passing suite.
> See `effect-v4-testing`.

Name the primary layer **`layer`** (e.g. `Database.layer`), never v3's
`Default` / `Live`. Use suffixes for variants (`layerTest`). The one exception
is the `index.ts` composite convenience export that merges two concept modules'
primary layers — `Default` is the idiomatic name there (see **Cycle-avoidance**
below); it is not a service's own primary layer, so it does not violate this
rule.

### Composition operators

| Operator | Feeds deps? | Keeps dep outputs? | Use for |
| --- | --- | --- | --- |
| `Layer.mergeAll(a, b, …)` | **no** | — (side by side) | combine outputs of independent layers |
| `Layer.provide(target, deps)` | yes | **no** — only `target` | hide construction deps behind a narrow public layer |
| `Layer.provideMerge(target, deps)` | yes | **yes** — target + deps | assemble larger app layers where downstream still needs the deps |

> **Trap:** `Layer.mergeAll(ConfigLayer, DatabaseLayer)` does **not** satisfy
> `DatabaseLayer`'s need for `Config` — merge only places them side by side.
> Use `provide` / `provideMerge` to actually feed a dependency.

**Compose subsystems locally, assemble one app layer, `Effect.provide`
once at the boundary.** Keep subsystem wiring named and local; the app
layer should read as a high-level map:

```ts
const DbSubsystem = Layer.provide(DatabaseLayer, ConfigLayer);
const AppLayer = Layer.mergeAll(DbSubsystem, HttpLayer).pipe(Layer.provide(Telemetry));

Effect.runPromise(program.pipe(Effect.provide(AppLayer))); // provide at the OUTERMOST edge
```

> **Cycle-avoidance (first boundary port):** put a composite layer that merges
> two concept modules — e.g. `Default = Layer.mergeAll(A.noop, B.noop)` — in
> `index.ts`, not in one of the concept modules. If it lived in module `A`, and
> `B` imports `A`, the merge would pull `A → B → A` into a cycle
> (`noImportCycles` is an error here). The entrypoint already depends on both
> concept modules, so hanging the composite there keeps the concept modules
> import-cycle-free.

Business logic *requires* services (they stay in `R`); composition happens
in layers; `Effect.provide` happens at the app / test entry point.
`Effect.provide` deep inside business logic is an anti-pattern — it hides
wiring, blocks test substitution, and spawns many small runtimes. For
several entry points (HTTP handlers, consumers, cron), build one
`ManagedRuntime.make(AppLayer)` and run each entry against it.

## Memoization: layers build once, by reference

v4 shares one `MemoMap` **across `Effect.provide` calls**, so the same
layer *value* is built exactly once and deduplicated — even if you provide
it twice:

```ts
const main = program.pipe(Effect.provide(DbSubsystem), Effect.provide(DbSubsystem));
// The Database pool is built ONCE. (v3 built it twice — one memo scope per provide.)
```

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

Probed on beta.94, counting resource opens: an inline factory call at two
provide sites opened the resource **twice**; the same factory called once and
bound to a `const` opened it **once**. The two-provide dedup is real, but it can
only dedup a reference it can recognize.

**A parameterized layer static is exactly this shape.** `static readonly layer =
(opts) => Layer.effect(...)` is a factory, and every `Svc.layer(opts)` at a
provide site is a fresh reference — the "it's a static, so it must be a
singleton" intuition is false.

Learn the **symptoms**, because the type system reports nothing and the tests
mostly pass:

- two database connections opened against one file;
- two ledgers / caches / counters, each holding half the writes;
- **a `PubSub` where each subscriber sees only half the events** — the publisher
  and the subscriber resolved *different* instances.

Anything that looks like "state mysteriously split in two" is this bug until
proven otherwise.

Discipline — **bind layers to named constants**:

- Prefer plain named layer `const`s over layer-returning factories.
- Write a layer-returning function only when the layer genuinely depends on
  runtime params — and even then, call it **once** and reuse the result.
- If a subsystem depends on a parameterized layer, **leave that dependency
  unprovided** and supply the concrete layer once **at the edge**. Don't
  call the factory locally inside subsystem wiring — it breaks sharing and
  hides the dep.

Auto-memoization is a safety net for the v3 multi-provide footgun, not a
license to skip composition. Compose explicitly, provide once.

**Opt out** when you deliberately want a fresh build (test isolation,
independent resource pools):

- `Layer.fresh(layer)` — always builds with a fresh memo map, bypassing the
  shared cache.
- `Effect.provide(layer, { local: true })` — builds the layer and its
  sublayers from a **local** memo map, isolated from other provides.

## Test layers

Swap the layer, not the code: business logic requires `Database`; production
provides `Database.layer`, tests provide a fake at the same boundary.

- `Layer.succeed(Service)({ ... })` — a full hand-written fake.
- `Layer.mock(Service, { ... })` — a **partial** mock; supply only the
  members the test exercises. Any omitted effect-returning member fails with
  an unimplemented defect if called, so the mock fails loudly instead of
  silently returning `undefined`:

```ts
const DatabaseTest = Layer.mock(Database, {
 query: (sql) => Effect.succeed(`mocked ${sql}`),
});

Effect.runPromise(program.pipe(Effect.provide(DatabaseTest)));
```

Keep test wiring explicit and close to the production composition style —
the Live/Test difference should be one swapped layer at the edge, nothing
deeper.
