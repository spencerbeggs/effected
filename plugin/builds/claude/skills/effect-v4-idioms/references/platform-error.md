# `PlatformError` — the error type of core IO

Core `FileSystem` / `Path` operations fail with `PlatformError`. This page
holds its shape, what `fs.exists` already absorbs, and how to construct one.

## The type is the doubled name

`effect` re-exports the module **as a namespace**
(`export * as PlatformError from "./PlatformError.ts"`, index.ts:507) and the
error **class** is declared inside it, so the type you write is
`PlatformError.PlatformError`:

```ts
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

const isGitRoot = (
  dir: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.exists(path.join(dir, ".git"));
  });
```

Written once it looks like a typo — which is exactly why it gets replaced with
`unknown`. Do not: typing a `FileSystem`-backed channel `unknown` collapses the
error early when the precise type is one `import type` away.
`fs.exists: (path: string) => Effect.Effect<boolean, PlatformError>`
(FileSystem.ts:169).

## The detail is in `reason`

A `PlatformError` wraps a `BadArgument` (rejected caller input) or a
`SystemError` (a host failure, carrying a normalized `SystemErrorTag`),
`PlatformError.ts:39,114,163`. Branch on `error.reason._tag`, not on the
message.

## `fs.exists` already absorbs `NotFound`; anything else is a real failure

Core derives `exists` from `access` in `FileSystem.make` (`FileSystem.ts:574`):
`access(path)` mapped to `true`, with a `PlatformError` whose `reason._tag` is
`"NotFound"` mapped to `false` and **every other reason re-failed**
(`EACCES`, `ENOTDIR`, `EIO`). So `fs.exists(p)` answers the question "is it
there?" and refuses to answer "may I see it?".

Appending `Effect.orElseSucceed(() => false)` therefore does not fix a missing
case — it is a **policy choice** to report an unreadable path as absent, and it
should be written and reviewed as one (a config *discovery* walk may want it; a
"write here" check does not). An in-memory test filesystem does not need it
either: `@effected/memfs` answers an unseeded path with `NotFound`, which
`exists` already maps to `false`.

## Construct one through the module's factories, never `new`

`new FileSystem.SystemError(...)` fails with "is not a constructor" — the
constructors are `PlatformError.systemError({...})` and
`PlatformError.badArgument({...})`.
