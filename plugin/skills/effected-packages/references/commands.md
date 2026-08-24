# @effected/commands

Structured command running (`Run`) and CLI tool discovery (`ToolDiscovery`) over Effect core's `ChildProcessSpawner` contract. Boundary tier: `effect` is the only peer, with **zero runtime dependencies, zero `@effected/*` edges and zero `node:` imports anywhere in `src/`** — IO arrives through `R` (core's `ChildProcessSpawner` for every run, core's `Stdio` for `Run.collectTee` alone), and the application provides a platform layer once at the edge. That zero is deliberate and conditional: `LocalExec.ts` declares the narrow contract `@effected/workspaces` implements, an inversion that keeps the edge count at zero. A direct `@effected/workspaces` edge would make this package integrated and, through `@effected/npm` → `commands`, drag `npm`, `lockfiles` (pure!) and `package-json` up a tier with it. **The one rule the package exists to obey: every subprocess concept here is core's, and no implementation of one is.**

Task-by-task teaching lives in the `running-commands-and-tools` skill; this is the surface map.

## Import

```ts
import { LocalExec, Redaction, Retry, Run, ScriptedSpawner, Tool, ToolDiscovery } from "@effected/commands";
```

Single entrypoint; no subpaths. Commands themselves are core values — `ChildProcess.make(...)` from `effect/unstable/process`, composed with core's own combinators.

## Feature surface

| Reach for | When |
| --- | --- |
| `Run.collect` / `.collectTee` | you want stdout, stderr and the exit code, with a non-zero exit as a *result* (tee also mirrors both streams live, and is the only member needing `Stdio` in `R`) |
| `Run.text` / `.lines` / `.json` | you want the interpreted value and a non-zero exit should fail typed |
| `Run.jsonLine` | a child reports through one JSON protocol payload line amid noisy stdout |
| `Run.exitCode` / `.succeeds` | you only care about the code, or the boolean, and never about a failure |
| `Run.stream` | output too large or too long-lived to accumulate |
| `Run.detach` | a background child must outlive the caller's scope |
| `Run.extendEnv` | add environment variables *without* wiping the parent environment |
| `ToolDiscovery.resolve` / `.isAvailable` | is this CLI tool here, and which copy (local vs global) should run |
| `Tool.named` | declare a tool with defaults (`--version`, `source: "any"`, `onMismatch: "preferLocal"`) |
| `LocalExec.layerFor(launcher)` / `ExecContext` | prefix commands through the project's package manager (`pnpm exec`, `npx`, `yarn exec`, `bun x`) |
| `Redaction` | scrub a secret from argv or from captured output |
| `Retry.transient` / `.isTransient` | classify a `CommandFailedError` as a transport hiccup and retry it |
| `ScriptedSpawner` | the shipped scripted `ChildProcessSpawner` double for unit tests |

## Core API

- **`Run`** — free functions exposed as statics, **not** a service: core's `ChildProcessSpawner` already *is* the subprocess service, and wrapping it in a second one is the re-declaration this package exists not to repeat. Every member takes a core `ChildProcess.Command` and requires `ChildProcessSpawner` in `R`. Members: `collect` (→ `CommandOutput`), `collectTee` (same, plus teeing both streams to `Stdio` in `R` — a separate combinator rather than an option, because an option cannot vary the `R` channel), `text` (→ trimmed stdout), `lines` (→ trimmed non-empty lines), `json(command, schema, options?)` (parses the **whole** of stdout, then decodes), `jsonLine(command, schema, options?)` (framing — see below), `exitCode` (→ `number`), `succeeds` (→ `boolean`, collapsing *any* classified failure to `false`), `stream(command, { includeStderr? })` (→ `Stream<string, CommandFailedError, …>`, never accumulating), `detach` (→ pid), `extendEnv` (dual-API command combinator), plus the re-exported constants `DEFAULT_MAX_OUTPUT_BYTES` and `REDACTED`. **The split that gives the family its reason to exist: a non-zero exit is a RESULT for `collect`, `collectTee`, `exitCode`, `succeeds` and `jsonLine`, and a typed `CommandFailedError` for `text`, `lines` and `json`.** Deliberate — it matches core (where a non-zero exit is a success) at the reporting level while giving the interpreting helpers the ergonomics callers want; do not "fix" either half.
- **`RunOptions`** — deliberately narrow, carrying only what a core `Command` cannot express: `timeout` (**no default**; expiry closes the run's scope, killing the child, and fails `CommandFailedError` of kind `"timeout"` rather than core's `TimeoutError`), `redact` (`ReadonlyArray<Redacted.Redacted<string>>`, matched by exact value wherever it appears), `maxOutputBytes` (default `DEFAULT_MAX_OUTPUT_BYTES`, 16 MiB per stream). `cwd`, `env`, `extendEnv`, `stdin`, `shell` and kill signals are core `ChildProcess.CommandOptions` fields — duplicating them is the re-declaration that killed a previous version of this package.
- **`CommandOutput`** — `Schema.Class` with `stdout`, `stderr` (both already redacted) and `exitCode`, plus a `succeeded` getter. Its `stdout` is **untrimmed**: read it when leading whitespace is data.
- **`CommandFailedError`** — `Schema.TaggedError` whose `kind` is the routing surface, never the message: `"nonZero"` (ran and exited non-zero), `"spawn"` (never started), `"timeout"` (a caller ceiling elapsed). Constructors `nonZero`, `spawn`, `timedOut`. `args` is **always** stored redacted, and messages tail-bound captured output at 2000 chars, keeping the end (tools write warnings first, the real error last).
- **`CommandOutputError`** — the process ran but its output is unusable: `kind` is `"notJson"`, `"schema"` or `"tooLarge"`. From `jsonLine` it additionally carries the exit code and both captured streams as context, so the failure is diagnosable without re-running.
- **`ToolDiscovery`** — `Context.Service<ToolDiscoveryShape>`; `ToolDiscovery.layer` requires `ChildProcessSpawner | LocalExec`. Members: `resolve(tool)` → `Effect<ResolvedTool, ToolResolutionFailure>` (that union being `ToolNotFoundError | ToolVersionMismatchError | ToolRefusedError | LocalExecError`), `isAvailable(tool)` → `Effect<boolean>` (never fails), `invalidate(tool)`, `invalidateAll`. **Absence is a spawn failure, never an exit code** — presence is decided by whether the process *ran*, so a tool whose `--version` exits 1 exists; there is deliberately no `command -v` probe. The cache holds **probe evidence keyed by `(name, version probe)`, never resolved answers**, with policy (`source`, `onMismatch`) applied per call; **only a positive result gets `Duration.infinity` and everything else gets zero**, because a memoized failure would stick for the process lifetime and a memoized "not found" would outlive a tool installed mid-process.
- **`Tool` / `ResolvedTool`** — `Tool` is a `Schema.Class` of `name`, `version` (a `VersionProbe`: `VersionFlag` / `VersionJson` / `VersionNone`), `source` (`ToolSource`: `"any" | "global" | "local" | "both"`) and `onMismatch` (`MismatchPolicy`: `"preferLocal" | "preferGlobal" | "fail"`); `Tool.named(name, overrides?)` is the 90% constructor. `ResolvedTool` carries `source` (`"global" | "local"`), `version`, `globalVersion`, `localVersion` (all `Option<string>`), `mismatch` and an optional `context`, and its **`command(...args)` returns a core `ChildProcess.Command`** — bare for a global resolution, launcher-prefixed and directory-scoped for a local one. Hand it straight to `Run`.
- **`LocalExec`** — `Context.Service<LocalExecShape>` whose single member is `context: Effect<Option<ExecContext>, LocalExecError>`; this is the contract `@effected/workspaces` implements. Layers: `layerNone` (no local context), `layerFor(launcher, { directory? })` from the static prefix table, `layerContext(context)` verbatim, and `layerTest`/`makeTest`. `Launcher` is `"npm" | "pnpm" | "yarn" | "bun"`; `LocalExec.prefixes(launcher)` and `.scriptPrefix(launcher)` expose the argv table. `ExecContext` (`label`, `prefix`, `dlxPrefix`, `scriptPrefix`, optional `directory`) applies itself to a standard command via `apply` / `applyDlx` / `applyScript`. **`prefixes(launcher)` is the one home of the four managers' argv**, and `scriptPrefix` is a **required** field so an implementation cannot forget it — npm's is `["npm", "run", "--"]`, because bare `npm run <script> --flag` claims the flag for npm.
- **`Redaction`** — two mechanisms, deliberately layered. `apply(text, secrets)` and `applyArgs(args, secrets)` redact **by value**: exact, literal matching, so a base64- or URL-encoded secret is *not* found (declare the encoded form too). `scrubArgs(args)` is a **flag heuristic** over `SECRET_FLAGS` and npm auth keys, in both `--token abc` and `--token=abc` forms, and runs **in addition, never instead**. `REDACTED` is the `***` placeholder.
- **`Retry`** — `isTransient(error)` and `transient(options?)`, a ready-made `Effect.retry` policy (jittered exponential backoff, bounded attempts) rather than a runner: `Run.text(cmd).pipe(Effect.retry(Retry.transient()))`. Two classifications are structural and matter more than `TRANSIENT_PATTERNS`: **a missing executable is never transient** (retrying cannot install a tool), and **a timeout is not transient by default** (a deterministically hanging command would burn its whole ceiling every attempt) — a caller who knows better opts in through `transient`'s `while`.
- **`ScriptedSpawner`** — the shipped public double. `ScriptedSpawner.make(script)` returns `{ layer, spawns }`, where `script: (command, args) => ScriptResult` decides each spawn and `spawns` is the recorded `SpawnRecord` log (`command`, `args`, `cwd`, `env`, `extendEnv`, the full `options`, and `unrefed`). `ScriptedSpawner.notFound(command)` and `.permissionDenied(command)` mint the platform errors the discovery classification rests on.

## Usage

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

const runnable = program.pipe(Effect.provide(AppLayer));
```

## Testing machinery

`ScriptedSpawner.make` for units — stub the spawner, then assert on its spawn log; never stub `Run`, which is free functions over the contract the double already implements. `ToolDiscovery.makeTest` / `layerTest` and `LocalExec.makeTest` / `layerTest` take partial overrides. **The two doubles do not default the same way, on purpose:** `ToolDiscovery.makeTest` dies on every unstubbed member, while `LocalExec.makeTest` answers `Option.none()`, because that *is* the global-only wiring and not a fabrication (a recorded exception to the house rule, tested by "would a real implementation legitimately answer this?"). `@effect/platform-node` is a devDependency for `__test__/e2e/` only.

## Gotchas

- **`Run.text` trims leading *and* trailing whitespace**, and `Run.lines` trims each line, silently corrupting fixed-column output — `git status --porcelain`'s leading-space status column produces plausible wrong values rather than an error. Parse that from `Run.collect`'s untrimmed `CommandOutput.stdout`.
- **`Run.jsonLine` is framing, not a lenient `Run.json`.** It scans stdout lines from the **end** and takes the first that both JSON-parses and decodes, tolerating noise on either side of the payload — so if two lines decode, the **last** wins. Give your envelope a required literal (`ok: true | false`) so a stray `console.log(someObject)` cannot satisfy it. It parses **regardless of the exit code** (a protocol payload discriminates success in-band); for exit-code semantics over whole-stdout JSON use `Run.json`. The tolerance is positional, not volumetric: noise still counts against `maxOutputBytes`. Never re-hand-roll last-line parsing at a call site.
- **Use `Run.extendEnv`, never bare `ChildProcess.setEnv`, to add variables.** Core's `setEnv` merges into `options.env` but never sets `extendEnv`, and the Node spawner resolves the child environment as `extendEnv ? { ...process.env, ...env } : env` — so `setEnv({ X: y })` spawns a child whose ENTIRE environment is that one variable: no `PATH`, no `HOME`. Silent at the type level, surfacing as "spawned tool cannot find its own binary". A hermetic environment is what bare `setEnv` is for.
- **`Run.detach` is spawn → `unref` → pid, and the ordering is the whole point.** The Node backend's release skips the kill for an unref'd child; reversed, the child dies with the caller's scope.
- **`{ concurrency: "unbounded" }` inside `collect` is load-bearing.** Reading stdout, stderr and the exit code sequentially deadlocks the moment either OS pipe buffer fills, and a mock spawner cannot reproduce it — the e2e backpressure test is the only thing that pins it.
- **A pipeline has no single argv.** Error reporting describes it as `left | right` with both sides' arguments dropped rather than merged.
