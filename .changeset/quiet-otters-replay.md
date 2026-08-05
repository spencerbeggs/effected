---
"@effected/workspaces": minor
---

## Features

Added `ConfigDependencyHooks.layerSubprocess`, a drop-in alternative to `layerLive` that replays `configDependencies` `updateConfig` pnpmfile hooks in a `node` child process instead of an in-process dynamic `import()`.

`layerLive` computes its `import()` path at runtime, and bundlers that compile a computed dynamic import into a context module (rspack, notably) can't resolve it at runtime — so in a bundled consumer such as a GitHub Action, the in-process replay is unreachable. `layerSubprocess` keeps every computed load out of the bundle graph by running the replay in a child process, with typed semantics identical to `layerLive`: the same hook-locator shapes, the same tolerant threading of a hook's returned config, and the same fail-open/fail-typed split between a legitimate missing pnpmfile and a real load or replay failure.

```ts
import { ConfigDependencyHooks } from "@effected/workspaces";
import { NodeServices } from "@effect/platform-node";

const program = Effect.gen(function* () {
	const hooks = yield* ConfigDependencyHooks;
	return yield* hooks.inject(root, configDependencies, seed);
}).pipe(Effect.provide(ConfigDependencyHooks.layerSubprocess), Effect.provide(NodeServices.layer));
```

Two new composites wire it through the higher-level layers, each requiring core's `ChildProcessSpawner` in `R`:

- `WorkspaceCatalogs.layerWithConfigDependenciesSubprocess(options?)`
- `Workspaces.layerWithConfigDependenciesSubprocess(options?)`

No existing surface changed or removed.
