# Entry points and layers

## The uniform entry guard

Every entry file — `pre.ts`, `main.ts`, `post.ts` — is a program import and one conditional call, guarded on the runner's own marker environment variable, and nothing else:

```ts
// main.ts
import { Action } from "@effected/github-actions";
import { program } from "./program.js";

/* v8 ignore next 3 -- entry-point guard, only runs inside a GitHub Actions runner */
if (process.env.GITHUB_ACTIONS) {
 await Action.run(program);
}
```

The same shape on every entry — never a bespoke variant for `post` — is what keeps `program`/`post` importable and testable without executing them as an import side effect. A test process that imports this module needs the runner's marker variable absent in its own environment; see [tests.md](tests.md) for the setup step that guarantees it.

`pre.ts` exists only when the lifecycle needs it — a token provisioned once and read back later, credentials that must be validated before `main` does any work. An action with no such need ships no `pre.ts` at all; an empty placeholder file is not more honest than its absence.

## `post.ts` is double-netted

A cleanup phase must never turn a successful run into a failed one. Wrap its whole program in both a normal-error catch and a defect catch, each demoting to a logged warning:

```ts
// post.ts
export const post: Effect.Effect<void, never, /* … */> = Effect.gen(function* () {
 // cleanup work
}).pipe(
 Effect.catch((error) => Effect.logWarning(`Post-action warning: ${String(error)}`)),
 Effect.catchDefect((defect) => Effect.logWarning(`Post-action warning: ${String(defect)}`)),
);
```

Both nets matter: a typed failure without the defect net still crashes the process on a bug; a defect net without the typed-error net still fails the workflow on an ordinary, anticipated error.

## Layers start empty, and grow only on genuine need

An entry passes no `layer` option at all by default — the runtime's own default already provides everything a program needs, and a configuration-derived service is built *inside* the program from already-decoded input values, not supplied from outside:

```ts
// layers/app.ts
export const makeAppLayer = (someDecodedValue: boolean): Layer.Layer<SomeService> =>
 SomeService.layerFrom(someDecodedValue);
```

```ts
// program.ts
const outputs = yield* pipeline(inputs).pipe(Effect.provide(makeAppLayer(inputs.someFlag)));
```

An entry grows an explicit `layer` argument back only when a service must exist *before* inputs are decoded, or crosses a boundary the program itself does not own — never as a precaution. Starting every entry populated invites providing capabilities nothing in the program actually requires, which is exactly what a layer-minimalism check exists to catch (see `designing-an-action`'s checkpoints reference).

A layer that doesn't depend on a decoded value is a static `const`, not a function called at each composition site — layers memoize by reference, so a factory called twice mints two independent instances of whatever it builds. Compose more than one addition with the runtime's own layer-merging combinator, keeping the same add-only-what's-missing discipline as the count grows.
