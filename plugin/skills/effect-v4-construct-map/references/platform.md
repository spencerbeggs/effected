# Platform — v3 → v4

Verified against `effect@4.0.0-beta.94`. For the CLI and HTTP surfaces that moved
into core, see `effect-v4-cli`.

## `@effect/platform-node`

`NodeContext` **does not exist** in `@effect/platform-node@4.0.0-beta.94`. The
aggregate is `NodeServices`. And `NodeFileSystem.layer` alone does not satisfy
`FileSystem.FileSystem | Path.Path` — compose
`Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)`.

## Constructing a `PlatformError`

**`PlatformError.systemError({...})` is the constructor.** It lives in the
top-level `effect/PlatformError` module — *not* under `effect/platform/`.

| reach for | reality |
| --- | --- |
| `new FileSystem.SystemError({...})` | **throws** `FileSystem.SystemError is not a constructor` — `FileSystem` does not re-export it (`typeof` is `undefined`) |
| `PlatformError.systemError({ reason, module, method, pathOrDescriptor })` | the working constructor; returns a `PlatformError` |

~~~ts
import * as PlatformError from "effect/PlatformError"

PlatformError.systemError({
  reason: "NotFound",
  module: "FileSystem",
  method: "readFileString",
  pathOrDescriptor: path,
})
~~~

`effect/PlatformError` exports `BadArgument`, `PlatformError`, `SystemError`,
`badArgument`, `systemError`. The lowercase functions are the constructors; the
capitalized names are the types.

This is the single most common blocker when writing a `FileSystem.layerNoop`
fixture, because every stubbed method that must fail needs a `PlatformError` and
the obvious `new FileSystem.SystemError(...)` is a runtime throw, not a type
error — so it survives tsgo and dies in the test.
