# Fault injection — decorating one method of a real layer

Loaded from `effect-v4-testing`. The case: a service that must behave like the
real thing except for **one** method, which fails on demand — fail
`writeFileString` partway through, to prove staging aborts before promotion.

`FileSystem.layerNoop` covers the all-stub case and `Layer.mock` covers the
partial-stub case; neither decorates a *real* implementation. There is no
`FileSystem.layerWith` and no `Layer.mapService` in the vendored source
(`Layer.ts` / `FileSystem.ts` carry no such export) — the scaffold below
is the house recipe until a kit helper exists
([#145](https://github.com/spencerbeggs/effected/issues/145)).

## The scaffold: `Layer.effect` + spread the base + `Layer.provide(base)`

```ts
import { Effect, FileSystem, Layer, PlatformError } from "effect";

declare const baseFileSystemLayer: Layer.Layer<FileSystem.FileSystem>
const writeError = (path: string) =>
  PlatformError.systemError({ _tag: "Busy", module: "FileSystem", method: "writeFileString", pathOrDescriptor: path });

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
in one call (`Layer.ts:2067`; it is defined as
`provide(layer, effect(service, map(service, f)))`, so the decorated service is
built from the surrounding context and the result requires that service):

```ts
import { Context, Effect, FileSystem, Layer } from "effect";

class MyService extends Context.Service<MyService, { readonly stage: () => Effect.Effect<void> }>()("MyService") {
  static readonly layer = Layer.succeed(MyService, { stage: () => Effect.void });
}
declare const failOnceAfterFirst: (fs: FileSystem.FileSystem) => FileSystem.FileSystem["writeFileString"]

const subjectWithFailingWrite = Layer.updateService(
  MyService.layer,
  FileSystem.FileSystem,
  (fs) => ({ ...fs, writeFileString: failOnceAfterFirst(fs) }),
); // Layer<MyService, E, FileSystem.FileSystem | …> — provide the real FS beneath
void subjectWithFailingWrite;
```

Same spread caveats apply; the win is that the `Layer.effect` + `Layer.provide`
plumbing is written for you.

## Partial stubs of any service: `Layer.mock`

`Layer.mock(Key, partial)` (`Layer.ts:2308`) builds a service from a partial
implementation; any missing member
that is an `Effect` / `Stream` / `Channel` — or a function returning one — dies
with an `UnimplementedError` naming the method when it is exercised. Non-effect
properties are still required.

```ts
import { Context, Effect, Layer } from "effect";

class UserService extends Context.Service<
  UserService,
  {
    readonly config: { readonly apiUrl: string }
    readonly getUser: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>
    readonly deleteUser: (id: string) => Effect.Effect<void>
  }
>()("UserService") {}

const testUsers = Layer.mock(UserService, {
  config: { apiUrl: "https://test-api.com" },        // required: not an Effect
  getUser: (id: string) => Effect.succeed({ id, name: "Test User" }),
  // deleteUser omitted → dies with `UserService: Unimplemented method "deleteUser"`
});
void testUsers;
```

This is the generic counterpart of `FileSystem.layerNoop` and is preferable to a
hand-rolled object cast: a method you forgot fails **loudly at the call site**
instead of being `undefined`. It does not decorate a real implementation — for
that, the scaffold above.

## A deterministic temp directory: fault one method, seed the rest

A test that needs a **stable, predictable** temp path — to assert on a
message that echoes it, say, or to reuse the same path across two calls in
one test — cannot get one from the real `makeTempDirectoryScoped`, which
always mints a fresh random name. `@effected/memfs`'s
`MemoryFileSystem.layerFaultyWith(seed, faults)` faults exactly one method
against a seeded volume, delegating every other member to the real memfs
implementation:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";

const FIXED = "/tmp/effected-test-fixed";

const DeterministicTemp = MemoryFileSystem.layerFaultyWith(
  { [FIXED]: MemoryFileSystem.directory() }, // pre-create the directory the fault will "mint"
  {
    makeTempDirectoryScoped: () => Effect.succeed(FIXED),
  },
);

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(`${dir}/config.json`, "{}");
  return yield* fs.exists(`${dir}/config.json`);
});

console.log(await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(DeterministicTemp))));
// => true — the seeded directory, at the fixed path, actually holds the write
```

`makeTempDirectoryScoped` is a fault-eligible method — `MemoryFileSystemFaultMethod`
covers every function-valued `FileSystem.FileSystem` member — and its handler's
signature is exactly the method's own: `(options?) => Effect<string,
PlatformError, Scope> | undefined`, so `() => Effect.succeed(FIXED)` typechecks
directly against it. **Seed the directory the fault will "mint" ahead of time.**
The fault handler only substitutes the *name* `makeTempDirectoryScoped`
returns; it does not also create that directory in the volume the way the
real method does, so a write into the faked path fails `NotFound` unless the
seed already contains it — `MemoryFileSystem.directory()` is the plain
tagged-entry constructor for exactly that. Every other method — `writeFileString`,
`exists`, and anything else the test under it calls — delegates to the real,
honest memfs implementation untouched.

## Two instances of one layer in a single composition

`Layer.fresh(L)` (`Layer.ts:2164`) rebuilds with a new `MemoMap`,
so two branches of one composition get separate instances. It does **not** reset state
between tests inside a `layer(...)` group — that group builds its whole layer
once, and `fresh` only affects sharing *within* that single build.
