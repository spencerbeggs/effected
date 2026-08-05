# @effected/commands

## 0.3.0

### Features

* Added `Run.jsonLine(command, schema, options?)`, a framing variant of `Run.json` for a child process that reports through a single JSON protocol payload on its final stdout line.

  Unlike `Run.json`, which parses the whole of stdout and requires a zero exit, `Run.jsonLine` takes the last non-empty stdout line — tolerant of noise before it, such as a subprocess-loaded hook's own logging — and parses it regardless of exit code, since a protocol payload typically discriminates success in-band.

  ```ts
  import { Run } from "@effected/commands";
  import { Schema } from "effect";

  const Payload = Schema.Struct({ ok: Schema.Boolean });

  const result = yield* Run.jsonLine(ChildProcess.make("node", ["script.js"]), Payload);
  ```

  `CommandOutputError` also gains optional `exitCode`, `stderr` and `stdout` context fields (`stderr`/`stdout` redacted), populated when `Run.jsonLine` fails so the exit code and captured streams are available as diagnostic evidence when no usable payload arrives.

  Both additions are additive; no existing surface changed. [#288][#288]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#288]: https://github.com/spencerbeggs/effected/pull/288

## 0.2.1

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Breaking Changes

* `ExecContext` gains a required `scriptPrefix: ReadonlyArray<string>` field —
  the argv prefix that runs a `package.json` script (`["npm", "run", "--"]`,
  `["pnpm", "run"]`, `["yarn", "run"]`, `["bun", "run"]`). Any code constructing
  `ExecContext.make(...)` directly must now supply it; code going through
  `LocalExec.layer(launcher)` gets it automatically.

  ```ts
  // Before
  ExecContext.make({ label: "pnpm", prefix, dlxPrefix, directory });

  // After
  ExecContext.make({ label: "pnpm", prefix, dlxPrefix, scriptPrefix, directory });
  ```

### Features

* `LocalExec.scriptPrefix(launcher)` returns just the script-runner prefix for
  a launcher.
* `LauncherPrefixes` is now exported, so a consumer can hold or pass the whole
  `{ prefix, dlxPrefix, scriptPrefix }` record without re-deriving its shape.
* `ExecContext.applyScript(command)` runs a `package.json` script by name,
  mirroring `apply` and `applyDlx`.

npm's script prefix is `["npm", "run", "--"]`, not `["npm", "run"]` — a bare
`npm run <script> --flag` silently claims `--flag` for npm itself instead of
forwarding it to the script; the other three launchers forward post-script
arguments without the extra `--`.

### Documentation

* `Run`'s class remarks now document that `Run.text` and `Run.lines` trim
  whitespace (not just a trailing newline), alongside the existing exit-code
  split between `Run.collect`/`exitCode`/`succeeds` (result-based) and
  `Run.text`/`Run.lines` (typed-failure-based). Output where leading whitespace
  is data — `git status --porcelain`'s status column — should be read from
  `Run.collect`'s untrimmed `stdout` instead. [#191][#191]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

* First release. Structured command running and CLI tool discovery over Effect
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
  whether `unref` ran) for assertions in a consumer's own test suite. [#180][#180]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
