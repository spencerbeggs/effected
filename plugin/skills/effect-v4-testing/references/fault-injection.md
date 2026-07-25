# Fault injection — decorating one method of a real layer

Loaded from `effect-v4-testing`. The case: a service that must behave like the
real thing except for **one** method, which fails on demand — fail
`writeFileString` partway through, to prove staging aborts before promotion.

`FileSystem.layerNoop` covers the all-stub case and `Layer.mock` covers the
partial-stub case; neither decorates a *real* implementation. There is no
`FileSystem.layerWith` and no `Layer.mapService` in `effect@4.0.0-beta.101`
(`Layer.ts` exports checked) — the scaffold below is the house recipe until a
kit helper exists ([#145](https://github.com/spencerbeggs/effected/issues/145)).

## The scaffold: `Layer.effect` + spread the base + `Layer.provide(base)`

```ts
const stagingFailFs = (armed: () => boolean): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const base = yield* FileSystem.FileSystem; // the REAL service, from below
      let writesWhileArmed = 0;
      return {
        ...base,
        // Effect.suspend: the counter must move when the effect RUNS, not when it is built
        writeFileString: (path, data, options) =>
          Effect.suspend(() => {
            if (!armed()) return base.writeFileString(path, data, options);
            writesWhileArmed += 1;
            return writesWhileArmed > 1
              ? Effect.fail(writeError(path))
              : base.writeFileString(path, data, options);
          }),
      };
    }),
  ).pipe(Layer.provide(baseFileSystemLayer)); // base resolves from HERE, not the test env
```

Three ways to get it subtly wrong, all seen:

- **Forgetting `Effect.suspend`.** The arming check and the counter then run at
  construction time, so the fault fires for a write that was only *described* —
  the same eager-recorder trap the main skill documents for `layerNoop`.
- **Dropping an options argument.** `{ ...base, writeFileString: (path, data) => … }`
  typechecks against a looser signature and silently discards `options`; the
  decorated method must forward every parameter to `base`.
- **Shadowing an unrelated method.** The spread is positional-by-name — a typo
  adds a member instead of overriding one, and the real method keeps running.

Because the decorated layer *requires* the base service it is decorating,
`Layer.provide(base)` is what closes the loop. Provide the real layer beneath,
not alongside.

## Shorter form when the subject is itself a layer

If the thing under test is a layer that *consumes* the service (rather than the
test body reading it directly), `Layer.updateService` writes the same decoration
in one call (`packages/effect/src/Layer.ts:1999`; it is defined as
`provide(layer, effect(service, map(service, f)))`, so the decorated service is
built from the surrounding context and the result requires that service):

```ts
const subjectWithFailingWrite = Layer.updateService(
  MyService.layer,
  FileSystem.FileSystem,
  (fs) => ({ ...fs, writeFileString: failOnceAfterFirst(fs) }),
); // Layer<MyService, E, FileSystem.FileSystem | …> — provide the real FS beneath
```

Same spread caveats apply; the win is that the `Layer.effect` + `Layer.provide`
plumbing is written for you.

## Partial stubs of any service: `Layer.mock`

`Layer.mock(Key, partial)` (`Layer.ts:2262`, `@since 3.17.0`, present at
beta.101) builds a service from a partial implementation; any missing member
that is an `Effect` / `Stream` / `Channel` — or a function returning one — dies
with an `UnimplementedError` naming the method when it is exercised. Non-effect
properties are still required.

```ts
const testUsers = Layer.mock(UserService, {
  config: { apiUrl: "https://test-api.com" },        // required: not an Effect
  getUser: (id: string) => Effect.succeed({ id, name: "Test User" }),
  // deleteUser omitted → dies with `UserService: Unimplemented method "deleteUser"`
});
```

This is the generic counterpart of `FileSystem.layerNoop` and is preferable to a
hand-rolled object cast: a method you forgot fails **loudly at the call site**
instead of being `undefined`. It does not decorate a real implementation — for
that, the scaffold above.

## Two instances of one layer in a single composition

`Layer.fresh(L)` (`Layer.ts:2100`) rebuilds with a new `MemoMap`, so two
branches of one composition get separate instances. It does **not** reset state
between tests inside a `layer(...)` group — that group builds its whole layer
once, and `fresh` only affects sharing *within* that single build.
