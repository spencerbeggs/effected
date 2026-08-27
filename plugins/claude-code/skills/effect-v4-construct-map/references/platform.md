# Platform — v3 → v4

Verified against `effect@4.0.0-rc.109` / `@effect/platform-node@4.0.0-rc.109`
(the satellite re-checked directly against the installed package, not inferred
from core). For the CLI and HTTP surfaces that moved into core, see
`effect-v4-cli`.

## `@effect/platform-node`

`NodeContext` **does not exist** in `@effect/platform-node@4.0.0-rc.109` —
there is no `NodeContext.d.ts` in `dist/`. The aggregate is `NodeServices`, and
its layer is plain `Layer.Layer<NodeServices>` with no error channel and no
requirements, where
`NodeServices = ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal`.
`NodeFileSystem.layer` alone does not satisfy
`FileSystem.FileSystem | Path.Path` — compose
`Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)`.

### `NodeHttpClient.layer` was removed

`@effect/platform-node@4.0.0-rc.109`'s `NodeHttpClient` exports `layerUndici`,
`layerUndiciNoDispatcher`, `layerNodeHttp`, `layerNodeHttpNoAgent`,
`layerDispatcher`, `layerAgent` and `layerAgentOptions` — there is **no**
`NodeHttpClient.layer`. A v3 layer that reached for `NodeHttpClient.layer`
now picks `layerUndici` or `layerNodeHttp` explicitly. Plain `FetchHttpClient`
(no platform package) lives in `effect/unstable/http` — see `effect-v4-cli`.

## `ChildProcessSpawner` — reach it namespace-qualified

The SKILL.md rename table and `migration-checklist.md` map
`@effect/platform/CommandExecutor` → `effect/unstable/process`'s
**`ChildProcessSpawner`**, which reads like a direct named import. It is not.
`effect/unstable/process`'s index re-exports each module as a **namespace**
(`export * as ChildProcessSpawner from "./ChildProcessSpawner.ts"`), and the
`effect` exports map has no deeper subpath under `unstable/process`. So the
service class is reached namespace-qualified:

```ts
import { ChildProcessSpawner } from "effect/unstable/process";
// the service/class is ChildProcessSpawner.ChildProcessSpawner
```

The module-name / class-name divergence costs a typecheck round otherwise. The
sibling `ChildProcess` module has the same shape.

## Constructing a `PlatformError`

**`PlatformError.systemError({...})` is the constructor.** It lives in the
top-level `effect/PlatformError` module — *not* under `effect/platform/`.

| reach for | reality |
| --- | --- |
| `new FileSystem.SystemError({...})` | **throws** `FileSystem.SystemError is not a constructor` — `FileSystem` does not re-export it (`typeof` is `undefined`) |
| `PlatformError.systemError({ reason, ... })` | **no `reason` field on the options** — the tag key is `_tag`; a `reason` property is a `tsc` error |
| `PlatformError.systemError({ _tag, module, method, pathOrDescriptor })` | the working constructor; returns a `PlatformError` |

```ts
import * as PlatformError from "effect/PlatformError"

PlatformError.systemError({
  _tag: "NotFound",   // SystemErrorTag — NOT `reason`
  module: "FileSystem",
  method: "readFileString",
  pathOrDescriptor: path,
})
```

`effect/PlatformError` exports `BadArgument`, `PlatformError`, `SystemError`,
`badArgument`, `systemError`. The lowercase functions are the constructors; the
capitalized names are the types.

**`reason` is real, but it lives one level up.** `systemError`'s options take
`_tag: SystemErrorTag` (`PlatformError.ts:195`), one of `AlreadyExists`,
`BadResource`, `Busy`, `InvalidData`, `NotFound`, `PermissionDenied`, `TimedOut`,
`UnexpectedEof`, `Unknown`, `WouldBlock`, `WriteZero` (`:75`). It is the
**wrapper** `PlatformError` that carries `reason: BadArgument | SystemError`
(`:157`) — so you read `err.reason._tag` but you *write* `{ _tag }`. Passing
`{ reason: "NotFound" }` fails to typecheck on the missing `_tag`.

This is the single most common blocker when writing a `FileSystem.layerNoop`
fixture, because every stubbed method that must fail needs a `PlatformError` and
the obvious `new FileSystem.SystemError(...)` is a runtime throw, not a type
error — so it survives tsgo and dies in the test.
