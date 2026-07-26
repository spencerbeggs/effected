---
"@effected/commands": minor
---

## Features

First release. Structured command running and CLI tool discovery over Effect
core's `ChildProcessSpawner` — this package owns no subprocess vocabulary and
no spawner backend; it adds the outcome, the policy and the tool-discovery
layer on top of core's own `ChildProcess.Command`.

### `Run` — typed command output

`Run.collect` / `Run.exitCode` / `Run.succeeds` report a non-zero exit as a
result; `Run.text` / `Run.lines` / `Run.json` treat it as a typed
`CommandFailedError`. `Run.extendEnv` merges environment variables onto a
command **without** dropping the inherited parent environment (`PATH`,
`HOME`, …) — the trap a bare core `setEnv` falls into. `Run.stream` and
`Run.detach` round out the surface, plus `Redaction` (secret scrubbing by
value or by flag heuristic) and `Retry` (transient-failure vocabulary for
`Effect.retry`).

### `ToolDiscovery` — find a tool and know which one you got

```ts
import { LocalExec, Run, Tool, ToolDiscovery } from "@effected/commands";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
  const discovery = yield* ToolDiscovery;
  const biome = yield* discovery.resolve(Tool.named("biome"));
  return yield* Run.text(biome.command("check", "."));
});

const AppLayer = ToolDiscovery.layer.pipe(
  Layer.provide(LocalExec.layerFor("pnpm", { directory: "/repo" })),
  Layer.provide(NodeServices.layer),
);
```

Presence is decided by whether the process ran, not by its exit code, so a
tool whose `--version` exits 1 still counts as found. `LocalExec` is the
narrow contract a workspace tool (`@effected/workspaces`) implements to teach
`ToolDiscovery` how to run a package manager's own binaries.

### `ScriptedSpawner` — a public test double

`ScriptedSpawner.make(script)` provides core's `ChildProcessSpawner` from a
scripted response list and records every spawn (command, args, cwd, env,
whether `unref` ran) for assertions in a consumer's own test suite.
