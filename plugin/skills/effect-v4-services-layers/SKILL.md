---
name: effect-v4-services-layers
description: Use when defining Effect v4 services or wiring Layers — the `Context.Service` class form (type params first, then the id), Layer construction (succeed/effect, scoped is gone), composition (mergeAll vs provide vs provideMerge), providing once at the boundary, and the memoization discipline that keeps a db pool or HTTP client from being built twice. Consult before reaching for any v3 name; see effect-v4-construct-map for the v3→v4 lookup.
---

# Services & Layers (Effect v4)

**API surface** — existence, signatures and the source line citations below —
verified against `effect@4.0.0-beta.107` on 2026-08-12 by reading
`packages/effect/src`. The **behavioural** claims are older and were not
re-probed: the memoize-by-reference resource-count result and the two
temporal-dead-zone results are beta.94 probes, and the sync-facade /
requirement-union notes are beta.97–98 probes, each dated where it appears.
Treat those as unverified at beta.107.

A service is a typed key into the runtime's context; a layer is the recipe that
builds it. Get three things right — the one service form, provide-once
composition, and memoization by
reference — and the wiring stays honest and cheap. For the v3→v4 name
lookup (what a construct *was* called), see `effect-v4-construct-map`; for
what any core module *is* and when to reach for it, `effect-v4-module-index`.

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

**What did NOT change: tags are still Effects.** A service key remains a
first-class Effect — `Context.Key<Identifier, Shape> extends
Effect<Shape, never, Identifier>` (`Context.ts:63` at beta.107) — so
`yield* Database` works, and combinator-style consumer code like
`Effect.flatMap(Database, (db) => …)` composes directly with no `.asEffect()`
or unwrap step. Related gotcha when hunting the source: the module is
`Context.ts`; there is no `ServiceMap.ts`.

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

**A second trigger, which fires on a class *declaration* too: a static that reads
a module-local `make` declared further down the file.** The rule above covers the
class's own name; this one covers anything the static initializer touches
eagerly:

```ts
// THROWS at import: "Cannot access 'make' before initialization" — and typechecks clean
export class Repo extends Context.Service<Repo, Shape>()("Repo") {
 static readonly layer = Layer.effect(this, Effect.map(Dep, make));
}
const make = (dep: Dep): Shape => ({ … });   // ← evaluated AFTER the class body

// Fine — the arrow defers the read to layer-BUILD time:
 static readonly layer = Layer.effect(this, Effect.map(Dep, (dep) => make(dep)));
```

`Effect.map(Dep, make)` reads `make` while the static initializer runs — import
time; `(dep) => make(dep)` reads it when the layer is built. Same false green.
The arrow is correct in both declaration orders, so write it unconditionally.

### Resolve a dependency once at construction — only when it is stable

A service built with `Effect.gen` resolves whatever it `yield*`s **when the layer
is built**. Right for a pool, a client, a decoded config; wrong for anything a
caller is meant to vary. **Stable ⇒ resolve in `make`** and every call shares the
instance. **Varying it is the point ⇒ read it per call**, keeping it in the
method's `R`, so a caller's `Effect.provideService(op, Dep, other)` reaches the
code that uses it.

Getting this backwards is **silent**. A `Repo` resolved at construction made
`Repo.provide(…)` decorative: the wrapper compiled, ran, and changed nothing,
because the service had already captured the ambient instance. Nothing in the
types distinguishes the two — only a test that provides a *different* instance
and asserts the difference does. (Caught that way in the github work.)

Name the primary layer **`layer`** (e.g. `Database.layer`), never v3's
`Default` / `Live`. Use suffixes for variants (`layerTest`). The one exception
is the `index.ts` composite convenience export that merges two concept modules'
primary layers — `Default` is the idiomatic name there (see **Cycle-avoidance**
below); it is not a service's own primary layer, so it does not violate this
rule.

### A layer static belongs to the module owning the dependency, not the service

**Statics on one class share one module**, and a module is the unit of
reachability — so a layer variant needing something the service's own module must
not reach moves out:

> A layer-family static belongs to the module that **owns the dependency it
> needs**, not to the module that **declares the service**.

Three uses in the kit: `GitHubApp.clientLayer` (confines the JWT signer),
`Workspaces.localExecLayer` (builds `@effected/commands`' service, so `commands`
keeps zero `@effected/*` edges), `GitHubCacheBlobStore.layer` (confines
`@azure/storage-blob`). Such a static is named for its **variant**, not `layer`.
Test: *would putting this static on the service class make a dependency reachable
from a consumer that does not use it?*

### Swappable contracts: no ambient default, and ship values too

When the implementation is a **policy choice** the consumer must make, two rules:

1. **No ambient default in the composite layer.** `Layer.mergeAll` is
   **last-wins**, so `Layer.mergeAll(myDetector, Pkg.layer())` — the natural
   spelling of an override — silently loses to a merged-in default. Leave the
   requirement in `R`: wiring that forgets to choose does not compile, and
   consumers who never call the operation never supply a policy.
2. **Ship every implementation as a VALUE as well as a layer** (`static readonly
   npm: Shape` beside `static readonly layerNpm = Layer.succeed(this, this.npm)`).
   A consumer composing *around* the default cannot use a layer without
   re-entering the tag it is replacing; given the value, the wrapper is one
   delegating `Layer.succeed`.

Reasoning and the `PublishabilityDetector` precedent:
[references/service-design.md](./references/service-design.md), which also
carries the layer-static and value-only-service rules in full.

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

**Heterogeneous requirement unions need an up-front annotation.** Collecting
several values generic in a requirements union (an array of resolvers, a list of
layers feeding one generic parameter) pins the type parameter from the **first**
element; the later, wider elements are rejected rather than widening the union.
Annotate the collection where it is built —
[references/edge-cases.md](./references/edge-cases.md).

> **Type helpers are top-level.** `Layer.Success<typeof L>` and
> `Layer.Error<typeof L>` are module-level type exports (v4 source
> `Layer.ts:180` / `:165` — resolve the tree via `effect-v4-source-lookup`).
> There is no nested `Layer.Layer.Success` spelling to reach for.

## Platform capabilities: require in R, never own a backend

Effect v4's consolidated core **declares** the platform service contracts —
`FileSystem`, `Path`, `Terminal`, `Stdio` as stable `effect/*` modules, and
`ChildProcessSpawner` (subprocesses) under `effect/unstable/process` — while the
**implementations** live in `@effect/platform-*` (Node's `NodeServices.layer`
provides `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal`
in one layer). That split fixes the house default:

- **A library that needs a platform capability requires the core-declared
  service in its `R` channel** and the application provides the platform layer
  once at the edge. Requiring-in-R is free — it adds no dependency edge and no
  tier cost. This is how `walker`, `xdg` and `config-file` consume
  `FileSystem`, and how anything subprocess-shaped consumes
  `ChildProcessSpawner`.
- **Taking `@effect/platform-*` as a dependency edge is categorically
  different** — it drags the platform package into every consumer's tree
  (integrated tier). Do not conflate the two: "platform-node is tier 3" is a
  statement about dependency edges, never about `R`.
- Platform packages are legitimate **devDependencies for integration tests**,
  and legitimate **dependencies only in applications and app-edge packages**
  (a CLI binary, a server entrypoint).
- **A direct `node:` import in library code is a code smell**, most of the
  time. The sanctioned exceptions are documented Node-only overlays — a
  default layer or a sync escape hatch — never a contract or a
  business-logic path.

Before designing any service or seam, grep the core source — `unstable/`
included — for an existing contract (`effect-v4-source-lookup` resolves the
tree). A parallel subprocess vocabulary (`Command`/`CommandRunner` plus a
hand-rolled `node:child_process` layer) survived four review gates in this repo
before a source check found `effect/unstable/process` already declared all of it.

## Sync facades: per-call service values, not layers

A synchronous escape hatch over consumer-supplied ops (build-tool plugin hooks,
config-time contexts) takes service **values** provided per call with
`Effect.provideService` — never a Layer, so consecutive calls carrying different
ops cannot hit the memoize-by-reference trap below. The `FileSystem.makeNoop` /
hand-rolled-`Path` recipe and the honest `runSyncExit` unwrap:
[references/edge-cases.md](./references/edge-cases.md).

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

### `Layer.mock`'s optionality is earned, not given — and one plain member revokes it

`Layer.mock(Service, impl)` takes `PartialEffectful<S>`, not `Partial<S>`
(`Layer.ts:2304`). That type is not "everything optional" — it splits the shape
on one predicate:

```ts
// Layer.ts:2230 — a member is OPTIONAL iff it matches AnyEffectOrStream; else REQUIRED
export type PartialEffectful<A extends object> = Types.Simplify<
  & { [K in keyof A as A[K] extends AnyEffectOrStream ? K : never]?: A[K] }
  & { [K in keyof A as A[K] extends AnyEffectOrStream ? never : K]: A[K] }
>
// Layer.ts:2239 — AnyEffectOrStream = Effect | Stream | Channel, or a function returning one
```

So **any non-effectful member is required in every single mock**: a sync
function, a plain data property, a generic passthrough whose return type does
not resolve to `Effect`/`Stream`/`Channel`. Add one and every existing
`Layer.mock` call site must now spell out that member — the partial mock has
silently degraded to `Layer.succeed` with extra ceremony. The type system
reports it as "missing property" errors scattered across the test suite, far
from the service shape that caused them.

**House rule: no non-effectful members on a service shape.** A service is an IO
contract. A pure helper belongs on a static, a namespace, or a plain exported
function next to the pure class that owns the algorithm — never inside the
`Context.Service` shape. That keeps every member effect-valued, which keeps
every member optional, which keeps `Layer.mock` doing the one job it exists for.

> **The wrong fix: wrapping the pure helper in `Effect.succeed` to satisfy the
> rule.** It does buy back optionality — and it is the anti-pattern, not the
> remedy. It makes every caller pay a `yield*` for a computation that cannot
> fail, cannot suspend and needs no runtime; it hides a pure function inside an
> IO contract where nobody will find it; and it makes the thing untestable
> without a layer, which is exactly the cost the pure-core/effectful-edge split
> (see `effect-v4-planning`, pillar 1) exists to avoid. **Move the member off
> the shape. Do not decorate it into compliance.**

**The one bounded exception: a shape that is entirely ONE immutable value.** The
rule targets **mixed** shapes, where a pure member revokes the *methods'*
optionality. A service whose whole contract is data — a resolved environment
record, a set of discovered paths — has no behaviour to mock, so nothing
degrades: `Layer.succeed` is the correct and complete double, and `Layer.mock`
was never the tool. Apply the criterion, do not pattern-match it: *the entire
shape is one immutable value with no mockable behaviour* — not "mostly data",
not "the methods are trivial". The boundary is sharp: **the moment a method
appears, it is a service again**, and the rule above reapplies retroactively to
every field. Say so in the service's TSDoc when you declare one.

### `dual` belongs on pure classes, never on a service shape

`Function.dual` (the kit imports it as `Fn`) gives a combinator both the
data-first and data-last spelling — `Package.addDependency(pkg, name, spec)`
*and* `pkg.pipe(Package.addDependency(name, spec))`. That is the right shape on
a **pure** class: `@effected/package-json`'s `Package` and `@effected/semver`'s
`Range` / `SemVer` all use it, and they are pure Schema classes with no layer
anywhere near them.

Putting a dual member on a `Context.Service` shape costs more than it looks:

- A dual member's declared type is an **overload pair**. Any override — in a
  `Layer.mock` implementation, in a `Partial<Shape>` test-stub argument, in a
  hand-written fake — must satisfy **both** overloads, not just the one the test
  calls. The one-line stub that works for every other member
  (`layerTest({ read: () => Effect.succeed(x) })`) stops compiling, and the fix
  is to hand-write the full overloaded signature in the test.
- It is also a non-effectful member by the rule above whenever the data-last
  branch returns a function rather than an `Effect`, so it is `Layer.mock`-
  required on top of being overload-shaped.

The two rules compose into one design instruction: **service shapes carry plain,
single-signature, effect-returning methods. Everything cleverer lives on the
pure class.**
