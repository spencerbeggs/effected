# Layer statics and construction — `this`, import-time reads, and naming

`Layer.succeed` and `Layer.effect` are **dual**: the curried
`Layer.effect(Service)(effect)` is primary, but the data-first
`Layer.effect(Service, effect)` overload also works (handy for
`Layer.effect(this, this.make)`). Both compile.

## In a layer static, refer to the service as `this`

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

Probed: the class-expression form throws, the `this` form does not,
and the class-*declaration* form does not either.

**Write `this` unconditionally.** It is correct in both forms, so it costs
nothing and removes the whole question — and the failure it prevents is a
false green:

> The module throws **at import time** while **typechecking completely clean**.
> The only signal is vitest reporting **`0 tests passed` with exit 0** for every
> file that imports it. A suite that collects zero tests is not a passing suite.
> The `effect-v4-testing` skill covers reading that signal.

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

## Resolve a dependency once at construction — only when it is stable

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
and asserts the difference does.

Name the primary layer **`layer`** (e.g. `Database.layer`), never `Default` or
`Live`. Use suffixes for variants (`layerTest`). The one exception
is the `index.ts` composite convenience export that merges two concept modules'
primary layers — `Default` is the idiomatic name there (see the next section);
it is not a service's own primary layer, so it does not violate this
rule.

## Where a composite layer lives

Put a composite layer that merges two concept modules — e.g.
`Default = Layer.mergeAll(A.noop, B.noop)` — in `index.ts`, not in one of the
concept modules. If it lived in module `A`, and `B` imports `A`, the merge would
pull `A → B → A` into a cycle (an error under a `noImportCycles` lint). The
entrypoint already depends on both concept modules, so hanging the composite
there keeps the concept modules import-cycle-free.

## Type helpers are top-level

`Layer.Success<typeof L>` and `Layer.Error<typeof L>` are module-level type
exports (`Layer.ts:189` / `:173` — resolve the tree via
`effect-v4-source-lookup`). There is no nested `Layer.Layer.Success` spelling to
reach for.
