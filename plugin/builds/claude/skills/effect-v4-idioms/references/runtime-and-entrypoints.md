# Runtime and entrypoints

There is no `Runtime<R>` type carrying services and flags — the ambient service
set is just `Context<R>`. The run functions live on `Effect`.

## Running a program

- Capture the ambient services with `Effect.context<R>()`, then run a program
  against them with `Effect.runForkWith(services)(program)`.
- With no requirements: `Effect.runFork(effect)`.
- Boundary choices: `Effect.runPromise` (hand off to a Promise host),
  `Effect.runFork` (background/long-running), `Effect.runSync` (sparingly).
- The `Runtime` module now holds only process-lifecycle utils
  (`Runtime.makeRunMain`, `Runtime.defaultTeardown`).

## Import the platform packages by subpath

Import `@effect/platform-node` and `@effect/platform-bun` by subpath, never
from the package root: `import * as NodeRuntime from
"@effect/platform-node/NodeRuntime"`, not `import { NodeRuntime } from
"@effect/platform-node"`. The root re-exports `NodeRedis`, so loading it
needs the package's required `redis` peer installed, even for a program that
never touches Redis; a subpath loads only its own module.

## Several entrypoints, one layer graph

For an application with multiple entrypoints sharing one layer graph, build a
`ManagedRuntime` once and reuse it:

```ts
const runtime = ManagedRuntime.make(AppLayer)
await runtime.runPromise(program)
// runtime.runFork(...) / await runtime.dispose() on shutdown
```
