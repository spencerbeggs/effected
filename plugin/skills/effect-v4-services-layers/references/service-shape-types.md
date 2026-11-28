# Service shape types — naming the shape, pinning a key, and accessors

## Typing a value that implements a service's interface

When a **factory returns an implementation** — a second `Layer` satisfying an
existing contract, a test double, a per-directory resolver — you need a name for
the service's *shape*, not for the service key. Two spellings resolve to the
same type, and one of them is the documented helper:

```ts
// Preferred: the named helper in the Service namespace.
function makeWorkspaceResolver(
 rootDir: string,
): Context.Service.Shape<typeof RegistryResolver> {
 return { resolve: (name) => Effect.succeed(`${rootDir}/${name}`) };
}

// Equivalent: indexed access through the key's witness property.
function makeOther(dir: string): (typeof RegistryResolver)["Service"] { ... }
```

`Context.Service.Shape<T>` is `T extends Key<infer _I, infer S> ? S : never`
(`Context.ts:423`), and it sits in a namespace whose own doc example is titled
"Extracting service types" — core states this as the way to name a service's
shape, so **prefer it**. The indexed form works for the same reason it reads
well: `Context.Key<Identifier, Shape>` carries `readonly Service: Shape` as a
real property (`Context.ts:71`), so `(typeof Tag)["Service"]` is an ordinary
lookup rather than a trick. The sibling `Context.Service.Identifier<T>` extracts
the `R`-channel identifier the same way.

**The trap this replaces: the class instance type is not the shape.** Reaching
for the obvious annotation — the class's own name — does not compile:

```ts
// WRONG. RegistryResolver (the instance type) is not { resolve: ... }.
function makeWorkspaceResolver(dir: string): RegistryResolver { ... }
// error TS2353: Object literal may only specify known properties,
// and 'resolve' does not exist in type 'RegistryResolver'.
```

A class-form key's instance type is `ServiceClass.Shape<Identifier, Shape>`
(`Context.ts:152`), a three-member wrapper — the `ServiceTypeId` brand, `key`,
and a `Service` member holding the real shape. The interface you want is nested
one level inside it, which is exactly what both spellings above unwrap.

**Taking a consumer's key over your shape?** Pin the shape. A
parameter typed `Context.Key<I, Shape>` or `Context.Service<I, Shape>`
accepts a key over a **wider** shape, because class keys compare structurally
and method bivariance makes that covariant. The fix is
`Context.Key<I, S> & ([Shape] extends [S] ? unknown : never)` with
`S extends Shape`; a key that adds members then errors as "not assignable to
parameter of type 'never'". It cannot see through method-syntax parameter
bivariance (a member redeclared as a method with a wider parameter still
passes). If the shape is generic (`Shape<A>`), also intersect
`Context.Key<I, Shape<A>>`, or `A` is no longer inferred from the key. The
worked failure messages and the `NoInfer` form are in `edge-cases.md` beside
this file.

## Accessors: `use`, `useSync` and the class as an Effect

`use` / `useSync` are static accessors — the only ones; there is no generated
proxy accessor per method. Reach for them sparingly — they hide *which* dependency you
pulled at the call site, making it easy to leak a service dep into a return
value:

```ts
Database.use((db) => db.query("SELECT 1")); // Effect<string, never, Database>
Config.useSync((c) => c.url);               // pure callback ⇒ Effect<string, never, Config>
```

`use` takes an effectful callback and returns `Effect<A, E, R | Self>`;
`useSync` takes a **pure** callback and returns `Effect<A, never, Self>` (it just
lets the accessor body be synchronous — both still return an `Effect`). There is
no mapped-type proxy that mints an accessor per method: such a proxy **erases
generics** — a `get<T>(key): Effect<T>` collapses to `Effect<unknown>` and
overloads are lost — which is why `use`/`useSync`, or plain `yield*`, are the
whole accessor story and preserve the real method signatures.

**The class IS the Effect — there is no `.asEffect()`.** `class Database
extends Context.Service<...>()("Database")` is itself an
`Effect<Shape, never, Database>`, so pass the class wherever an Effect goes:
`Effect.flatMap(Database, (db) => ...)`, `Database.pipe(Effect.map(...))`, or
as a value typed `Effect.Effect<Database["Service"], never, Database>`.
`.asEffect()` is `Effectable.Class`'s abstract method, not a service's;
calling it on a service class is a type error, not a conversion you forgot.
