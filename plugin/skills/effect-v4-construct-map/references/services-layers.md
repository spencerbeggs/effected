# Services & Layers — v3 → v4

Verified against `effect@4.0.0-beta.94+`. Idiomatic form → see
`effect-v4-services-layers`.

`Context.Tag`, `Context.GenericTag`, `Effect.Tag`, and `Effect.Service` **all
collapse to `Context.Service`**, with the type-params-first / id-string-second
arg order (the reverse of v3).

| v3 | v4 |
| --- | --- |
| `Context.Tag("id")<Self, Shape>()` | `Context.Service<Self, Shape>()("id")` — class form; type params first, then `()`, then the id |
| `Context.GenericTag<T>(id)` | `Context.Service<T>(id)` (function form) |
| `Effect.Tag(id)<Self, Shape>()` | `Context.Service<Self, Shape>()(id)` |
| `Effect.Service<Self>()(id, { effect, dependencies })` | `Context.Service<Self>()(id, { make })` + build the layer yourself; **no `dependencies` option** (wire via `Layer.provide`) |
| `Effect.Tag` static accessor proxy (`Svc.method(...)`) | **Removed.** `Svc.use((s) => ...)` / `Svc.useSync(...)`, but **prefer `yield*`** |
| Auto-generated `.Default` layer | **None.** Define `static readonly layer = Layer.effect(this, this.make)` |
| Layer named `Default` / `Live` | named `layer` (+ `layerTest`, `layerConfig`) |
| `Layer.scoped(...)` | **`Layer.effect(...)`** — it now covers scoped/resource-owning layers (strips `Scope` from `R`); `Layer.scoped` is gone |
| `Context.Reference<Self>()(id, opts)` | `Context.Reference<T>(id, opts)` (function form) |
| per-`provide` memoization scope | shared `MemoMap` across provides (built once); opt out via `Layer.fresh` or `Effect.provide(layer, { local: true })` |
| `Context.make` / `get` / `add` / `mergeAll` | unchanged (`Context.get(map, tag)`) |

> `Layer.effect` / `Layer.succeed` are **dual**: both the curried
> `Layer.effect(Svc)(effect)` and data-first `Layer.effect(Svc, effect)`
> compile in beta.94.

## The tag's *parameter type* is `Context.Key`, not `Context.Tag`

The table above is the **class-definition** site. When you *accept a tag as a
parameter* — writing a generic layer builder, say — the type is `Context.Key`:

~~~ts
const layer = <Self, A, I, RR = never>(
  tag: Context.Key<Self, ConfigFileShape<A>>,   // NOT Context.Tag — that name is gone
  options: ConfigFileOptions<A, I, RR>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | RR> => …
~~~

Three facts that cost real debugging time:

- **`Context.Key` is type-only.** `typeof Context.Key === "undefined"` at
  runtime, indistinguishable from "removed" under the obvious probe. So is
  `Context.Tag`. Check the `.d.ts`, not `typeof`.
- **`Key<out Identifier, out Shape>` — `Shape` is covariant.** A tag for a wider
  service satisfies a parameter typed for a narrower one. `Service` and
  `ServiceClass` are declared `in out Shape`, but **both extend `Key`**, so the
  invariance does not save you. Consequence: you *cannot* subtract a method from
  a service at a layer boundary — a "read-only" overload will typecheck and then
  the method will be missing at runtime. A service's shape is fixed at its
  `Context.Service` declaration.
- **`Context.Key` extends `Effect`.** `Effect.flatMap(tag, f)` needs no
  `.asEffect()`.
