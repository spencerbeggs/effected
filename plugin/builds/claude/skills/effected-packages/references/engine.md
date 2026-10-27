# @effected/engine

Pattern: `design-patterns`.

Platform-free primitives shared by every front end of an Effect v4 tool: carrier
distribution identity, a remediation shape, launch-context resolution, a
one-permit lane and scoped restores for process-global state, and
transport-neutral process crash guards (`./guard`). Pure
tier: `effect` is the only peer, and the only dependency of any kind — no
`process`, no `node:` import, no platform package, not even as a devDependency
edge into `src/`. What touches the process (`ProcessScope`) takes it as an
argument. There is no IO here and nothing to provide at the edge.

**Two kit packages depend on it:** `@effected/mcp` as a peer, and
`@effected/cli` as a regular dependency, for `MainOptions.distribution`. A
front end consumes both; engine depends on neither.

## Import

```ts
import {
  CurrentDistribution,
  Distribution,
  DistributionField,
  Exclusive,
  ExclusiveTimeout,
  LaunchContext,
  ProcessScope,
  ProcessScopeError,
  Remediation,
  distributionSuffix,
  withDistribution,
  withDistributionVersion,
} from "@effected/engine";
```

```ts
import { ProcessGuard } from "@effected/engine/guard";
```

Two entrypoints. `@effected/engine/guard` has **no runtime import at all** —
not even `effect` — so a server's `main.ts` can import it statically and its
listeners are installed before anything else evaluates. The main entry never
re-exports it.

## Core API

- **`Distribution`** — `Schema.Struct({ name, version })` + its decoded type: the
  carrier package (`@scope/plugin`) a tool's bins were installed through. A plain
  struct, not a `Schema.Class`, because it travels in JSON envelopes as a plain
  object and is compared structurally.
- **`DistributionField`** — `Schema.NullOr(Distribution)`: the `distribution`
  field of a machine-readable envelope, `null` when the front end was installed
  directly rather than through a carrier.
- **`CurrentDistribution`** — a `Context.Reference<Option.Option<Distribution>>`,
  not a `Context.Service`: it carries its own default (`Option.none()`), so a
  direct install needs no provision at all and reading it adds nothing to `R`. A
  front end's `main` provides it once, at the top of the program, with
  `program.pipe(withDistribution(options.distribution))`. A CLI on
  `CliRuntime.main` passes `distribution` there instead, which does both this
  and the `--version` suffix.
- **`withDistribution(distribution)`** — data-last: provides
  `CurrentDistribution` to an effect, `Option.some` of a carrier and
  `Option.none()` for `null` or `undefined`.
- **`distributionSuffix(distribution)`** — the `via <name> <version>` suffix
  (with a leading space) a `--version` line or a startup log line appends;
  `""` for a direct install (`Option.none()`).
- **`withDistributionVersion(distribution)(formatVersion)`** — decorates a
  `(name, version) => string` line formatter (shaped like `effect/cli`'s
  `CliOutput.Formatter["formatVersion"]`) so its line ends with
  `distributionSuffix`. It **wraps** the formatter in effect — a coloured
  default or a custom one — rather than replacing it; the suffix is computed
  once, when the decorator is applied.
- **`Remediation`** — `Schema.Struct({ hint, suggestedTool?, suggestedArgs? })` +
  its decoded type: what a caller — usually an agent — should do after a
  failure. The superset of two shapes consumers built independently: a
  folded-message shape and a structured-data shape. Both optional keys are
  `optionalKey`, so an explicit `undefined` is rejected rather than silently
  encoded.
- **`LaunchContext`** — a static-only class resolving where a tool launched by
  an agent host should treat as its project:
  - `LaunchContext.projectDir(input: ProjectDirInput): string` — the first
    usable `argv` value, then the first usable `env` value in `keys` order, then
    `cwd`. "Usable" means non-empty after trimming and free of a literal
    `${VAR}` placeholder — Claude Code passes `${CLAUDE_PROJECT_DIR}` through
    unsubstituted in some launch paths, and a path containing one is never what
    was meant.
  - `LaunchContext.resolve(input: ResolveInput): Option<string>` — the same
    walk without the `cwd` fallback, for any launch-supplied location (a
    host's plugin data directory, then an app override), with the caller's
    own fallback after it. `projectDir` is `resolve` plus `cwd`.
  - `LaunchContext.usable(value: string | undefined): Option<string>` — the
    guard both apply, for a single value (`LaunchContext.usable(argv[2])`):
    the trimmed value, or `Option.none()` for `undefined`, empty,
    whitespace-only or an unsubstituted placeholder.
  - `LaunchContext.isUnsubstituted(value: string): boolean` — whether a value
    still carries a literal `${VAR}` placeholder.
  - `ResolveInput` — `{ argv?, env, keys }`; `ProjectDirInput` extends it with
    `cwd`. Both interfaces, all caller-supplied.
    Nothing inside `LaunchContext` reads `process`; `argv`/`env`/`cwd` come from
    the front end's own `main.ts`, which keeps the resolution rule shared and
    testable while the `process` read stays at the one place allowed to make
    it.

- **`Exclusive`** — a one-permit lane for work that mutates process-global
  state (the working directory, the environment, a patched stream), so two
  requests never interleave it. `Exclusive.make: Effect<Exclusive>` — bind it
  once; every call shares the lane. `lane.run(body, { timeout })` →
  `Effect<A, E | ExclusiveTimeout, Exclude<R, Scope>>`; `timeout`
  (`Duration.Input`) is required. The ordering contract, on every exit path:
  waiting for the permit is interruptible (a request cancelled in the queue
  never runs); once the permit is held the caller's interruption is masked
  until the body ends (an MCP client cancel only drops the response); the
  timeout interrupts the body alone; the body runs in its own `Scope`, whose
  finalizers run before the permit is released and before the caller sees the
  result, an `ExclusiveTimeout` (`timeout` formatted, `message`), or its own
  deferred interruption. A body that ignores interruption delays the timeout
  and the release until it settles — deliberately. **Not reentrant**: a `run`
  on the same lane from inside a body waits on the permit its own caller holds
  until the outer timeout fires, so the outer `run` fails `ExclusiveTimeout`;
  call the inner work directly.
- **`Exclusive.promise({ try, catch, abandon? })`** — `ExclusivePromiseOptions`:
  `try(signal)` starts the promise, `catch(cause)` maps a rejection or a
  synchronous throw. Its interruption aborts `signal` and then **waits for the
  promise to settle**, where `Effect.promise`/`Effect.tryPromise` abandon it —
  so a promise that ignores its signal and never settles holds the interrupt,
  the lane's timeout and the permit forever. `abandon: true` (default `false`)
  aborts and resumes at once, leaving the promise running unobserved; the
  body's scope still closes before the permit is released. Choose it only for
  a promise that cannot be stopped, and restore what it touches in a
  finalizer.
- **`ProcessScope`** — scoped changes to process-global state, restored when
  the enclosing `Scope` closes. `ProcessScope.chdir(host: ProcessCwdHost,
  directory)` → `Effect<void, ProcessScopeError, Scope>` (`host` is
  `{ cwd(), chdir(dir) }`, which `process` satisfies; when the previous
  directory was deleted, the change still happens and nothing is restored).
  `ProcessScope.env(env, patch)` → `Effect<void, never, Scope>`: an `undefined`
  patch value deletes the key, and a key absent before is deleted again on
  restore, never assigned `undefined` (Node's `process.env` would store
  `"undefined"`). `ProcessScopeError` has `reason: "ChdirFailed"`, `path`,
  `message`, `cause`. Pair them with `Exclusive`: a scoped restore protects the
  next request only when nothing else runs while the change is live. There is
  no temp-directory helper: use core's `FileSystem.makeTempDirectory` in an
  `Effect.acquireRelease` whose release ignores a failed removal —
  `makeTempDirectoryScoped`'s release dies when the directory is already gone,
  turning a successful body into a defect.
- **`ProcessGuard`** (`./guard`) — `ProcessGuard.run(options): Promise<void>`
  installs `uncaughtException`/`unhandledRejection` listeners on a structural
  `ProcessGuardHost` (`on`, `emit`, `stderr`, `exit`; Node's `process`
  satisfies it), then awaits `options.load(guard)`. It launches nothing: `load`
  imports and starts the server over whatever transport, and calls
  `guard.markConnected()` once it is serving (an LSP from its listening
  callback; `McpGuard.run` from `McpStdio.launch`'s `onReady`) and
  `guard.useFormat(fn)` to upgrade the dependency-free formatter. Policy
  (`ProcessGuardPolicy`): `onUncaught: "exit" | "exitBeforeConnect"`,
  `onRejection: "exit" | "exitBeforeConnect" | "log"`, both defaulting to
  `"exit"`. A rejected `load` is `<label>: startup failed: …` and exit 1 under
  every policy. `injectCrash: { at: "load" | "connected", kind }` drives
  either half of a policy from a test (`ProcessGuard.parseInjectCrash(env)`
  parses the shared `<at>:<kind>` grammar from a variable, `undefined` for
  anything else); a stdio server is "serving" once its transport is built and
  reading stdin; the `"connected"` report lands on a
  later tick than `markConnected`, so a test waits for it rather than
  reading stderr once. `@effected/mcp/guard`'s `McpGuard.run` is this guard
  plus an MCP stdio launch.

## Usage

`argv` takes **parsed positional arguments only, never raw `process.argv.slice(2)`** —
every non-empty value counts as a candidate, so a leading `--flag` would become
the project directory:

```ts
import { LaunchContext } from "@effected/engine";

// WRONG — raw argv, unfiltered: a leading flag is a non-empty candidate and wins.
const rawArgv = ["--verbose", "/expected/project"];
console.log(
  "wrong (raw argv):",
  LaunchContext.projectDir({ argv: rawArgv, env: {}, keys: [], cwd: "/fallback" }),
);

// RIGHT — only the command's own parsed positionals reach projectDir.
const positionals = ["/expected/project"];
console.log(
  "right (positionals):",
  LaunchContext.projectDir({ argv: positionals, env: {}, keys: [], cwd: "/fallback" }),
);
```

```text
wrong (raw argv): --verbose
right (positionals): /expected/project
```

Where the positionals exist decides where `projectDir` is called:

- **An MCP server** has no command parser, so it resolves once in `main.ts`,
  from `process.argv.slice(2)` with every flag filtered out, or from an env
  var alone with `argv: []` — `effect-v4-mcp`'s `server-wiring.md`, "Project
  directory", has the runnable shape.
- **A CLI on `effect/cli`** has no parsed positionals in `main.ts`:
  `Command.run` reads the raw arguments from the platform `Stdio` and parses
  them after `main.ts` has already handed the program to the runner, so the
  command's own `Argument` values exist only inside its handler. Call
  `projectDir` there. `main.ts`, the one file allowed to read `process`,
  passes `env` and `cwd` down to the command as plain values:

```ts
import { CliRuntime } from "@effected/cli";
import { LaunchContext } from "@effected/engine";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";

// index.ts: the command tree. It reads no `process`; the launch facts it
// needs arrive as plain values.
interface LaunchFacts {
 readonly env: Readonly<Record<string, string | undefined>>;
 readonly cwd: string;
}

export const makeCommand = (launch: LaunchFacts) =>
 Command.make(
  "mytool",
  // Argument.String, not Argument.Path: a literal "${CLAUDE_PROJECT_DIR}"
  // must reach projectDir untouched so it can be recognised and skipped.
  { project: Argument.String("project").pipe(Argument.optional) },
  ({ project }) =>
   Effect.gen(function* () {
    // The parsed positional exists here, inside the handler, and nowhere earlier.
    const projectDir = LaunchContext.projectDir({
     argv: Option.toArray(project),
     env: launch.env,
     keys: ["MY_TOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
     cwd: launch.cwd,
    });
    yield* Console.log(`project: ${projectDir}`);
   }),
 );

// main.ts: the one file that reads process.
const command = makeCommand({ env: process.env, cwd: process.cwd() });
NodeRuntime.runMain(CliRuntime.main(Command.run(command, { version: "1.0.0" }), { platform: NodeServices.layer }));
```

Run as `mytool /work/project` it prints `project: /work/project`; as
`mytool --verbose` — an unknown flag — the parser rejects it as a usage
error (exit `64` under `CliRuntime.main`) and the handler never runs; with
no argument, or with a literal `${CLAUDE_PROJECT_DIR}` the host left
unexpanded, it falls through to `MY_TOOL_PROJECT_DIR`, then
`CLAUDE_PROJECT_DIR`, then the working directory.

## Gotchas

- `LaunchContext.projectDir` never returns an empty string when `cwd` is
  non-empty (a property test pins this) — an env value that decodes to `""`
  or whitespace-only is treated as absent, not as "found but empty".
- `Exclusive.run` inside another `run` on the same lane is a deadlock that
  surfaces as the outer `ExclusiveTimeout`, not as an error naming the nesting.
- `CurrentDistribution` is a reference, not a service: `yield* CurrentDistribution`
  works with nothing provided (`Option.none()` default) — do not reach for
  `Layer.succeed` to give it a value; use `withDistribution` (or `Effect.provideService`).
- `ProcessGuard`'s report lines are fixed: `<label>: uncaughtException
  (<origin>): …`, `<label>: unhandledRejection: …`, `<label>: startup
  failed: …`. Only `label` is configurable.
- `markConnected` is the only thing that makes `"exitBeforeConnect"` stop
  exiting. `load` resolving is not "connected": a caller that never calls it
  keeps exiting on every stray crash, and `injectCrash: { at: "connected" }`
  is never raised.
- Purity is pinned by the package's own source-boundary test over
  `SourceBoundary.scan` from `@effected/workspaces/testing` (a devDependency;
  engine takes no runtime kit edge).
