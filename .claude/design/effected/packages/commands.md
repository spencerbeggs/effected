---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
completeness: 90
related:
  - ../effect-standards.md
  - ../roadmap.md
  - ../package-inventory.md
  - git.md
  - workspaces.md
  - npm.md
---

# @effected/commands design

## Overview

`@effected/commands` is the kit's **tool-and-output layer over core's subprocess contract**. It owns two concerns that every consumer repo has re-invented:

1. **Tool discovery** — is `biome` (or `npm`, or `tar`) available here, globally on `PATH` or project-locally through the package manager's exec, what version is each, and which one should we run? Generalized from silk-effects' `ToolDiscovery` (`/Users/spencer/workspaces/savvy-web/systems/packages/silk-effects/src/services/ToolDiscovery.ts`).
2. **Structured running** — take a core `ChildProcess.Command`, run it to completion, and get back typed structured output: collected stdout/stderr/exit code, trimmed text, lines, schema-decoded JSON, or a boolean probe — with a non-zero exit as a **typed error**, optional live echo, optional timeout, and secrets redacted out of both the error and the captured output. This replaces `@savvy-web/github-action-effects`' `CommandRunner`.

It fills the [roadmap's reserved `@effected/commands` slot](../roadmap.md#effectedcommands) and is **Phase 1a** of the [GitHub/Actions split program](../../../plans/2026-07-25-github-split-master.md).

The package is designed **against** core's `effect/unstable/process` vocabulary, never around it: a caller builds a `ChildProcess.Command` with core's constructors and combinators (`make`, `prefix`, `setCwd`, `setEnv`, `pipeTo`) and hands it to this package to run. See [What this package deliberately does not do](#what-this-package-deliberately-does-not-do) — that boundary is the whole point of the package, and it is the correction of a recorded failure.

### REVERSAL 2 is the frame, not a footnote

An earlier `@effected/commands` was built, pivoted, and then removed from the kit entirely. The two superseded plans — `.claude/plans/2026-07-14-commands-runner-core.md` and `2026-07-14-commands-spawner-pivot.md` (both marked SUPERSEDED, and RECONSTRUCTED on 2026-07-25 after being deleted from disk; the directory is gitignored, so git holds no history of them) — record **two distinct re-inventions**, and the second is the one that actually killed the package:

1. **Inventing the vocabulary.** The runner-core plan built `Command` (a `Schema.Class` with `executable`/`args`/`cwd`/`env`/`timeout`), a `CommandRunner` `Context.Service` with `run`/`available`, a `CommandSpawnError`, and a `layerNode` wrapping `node:child_process.execFile` — every one of which core already declares in `effect/unstable/process`.
2. **Owning the implementation.** The spawner-pivot plan correctly deleted all of that ("import the vocabulary, never re-declare it") — and then **ported `@effect/platform-node-shared`'s `NodeChildProcessSpawner` into the package** as a zero-dependency `layerNode`. That is a *backend*, and shipping one is what the reversal finally rejected: the package still owned platform specifics, just with core's type names on them.

The second point is the load-bearing one for any reviewer of *this* design, because "use core's contract" is necessary but **not sufficient** — a package can consume core's vocabulary faithfully and still be wrong by implementing it. [effect-standards.md](../effect-standards.md#the-consolidated-core-and-the-require-in-r-default) states the rule both halves violate: *"we are in the business of business logic … we never re-implement platform specifics"*, and *"before designing any seam or contract, grep `.repos/effect` for the core contract first."*

This design's obligation is therefore stated up front and checked in review: **every subprocess concept in this package is core's, and no implementation of one is.** The only new vocabulary is the *outcome* (collected output, typed failure), the *policy* (timeout, redaction, transience), and the *tool* (discovery, version, source). One prior piece of that superseded work **was** sound and is carried forward: the pivot's Task P3 `runCollected` / `available` helpers — concurrent collection to dodge pipe-buffer deadlock, and "any completed run means available, a `PlatformError` means not" — which now live privately in `@effected/git`'s `internal/run.ts` and are promoted here to public API rather than copied a third time.

### Two places this design knowingly diverges from the superseded plans

Both are recorded because a reviewer holding those plans will otherwise read them as regressions. The first was reviewed and **accepted** on 2026-07-25 (see [Decisions recorded](#decisions-recorded)); the second was never a conflict on inspection.

- **The pivot plan ruled out a timeout parameter; this design has one.** Its Task P3 says: *"No timeout parameter anywhere: callers compose `Effect.timeout` (git owns its 30s policy)."* That was right for a package that was a backend plus two thin helpers, and it is why `@effected/git` owns its own 30-second ceiling. It is wrong for a *generic* runner: a `pnpm install` and a `git rev-parse` cannot share a default, which is why `RunOptions.timeout` has **no default at all** — the caller opts in or gets no ceiling, so the helper imposes no policy. What the option buys over bare `Effect.timeout` is the error channel: `Effect.timeout` fails with core's `Cause.TimeoutError`, widening every caller's channel with a non-domain error, whereas `Run` absorbs it into `CommandFailedError` with `kind: "timeout"` — exactly how `@effected/git`'s `runClassified` absorbs `Cause.TimeoutError` and `PlatformError` so consumers only ever see git's taxonomy.
- **The pivot plan said the package defines no error type; this design defines two.** Its constraint was *"`@effected/commands` defines no error type and no command type"* — correct for a backend, whose declared error channel is core's `PlatformError` by contract. This package is a different artifact: it **classifies an outcome** that core deliberately leaves unclassified (in core, a non-zero exit is a *success*), and "the command failed" is domain vocabulary, not platform plumbing. `@effected/git` sets the precedent already — it defines `GitCommandError` / `NotARepositoryError` / `UnknownRefError` over the same contract and absorbs `PlatformError` behind them. The half of the constraint that still binds is the one this design keeps: **no command type.**

## Tier and dependencies

**Boundary tier**, and it stays there **only because the workspaces edge inverts** (next section).

- `effect` is the only peer. **Zero runtime dependencies, zero `@effected/*` edges, zero `node:` imports.**
- IO arrives through the `R` channel: core's `ChildProcessSpawner` for every run, and core's `Stdio` for the echoing variants only. Requiring core-declared services in `R` costs a consumer nothing under [R3](../effect-standards.md#dependency-policy) — the walker/xdg/`@effected/git` pattern.
- `@effect/platform-node` appears in `devDependencies` only, for integration suites (the `@effected/git` and `@effected/workspaces` precedent). devDependencies never count toward tier.

## The workspaces edge: contract inversion, and why it is not optional

**The question.** `ToolDiscovery`'s local resolution needs to know how to run a project-local binary: `pnpm exec <tool>`, `npx --no -- <tool>`, `yarn exec <tool>`, `bun x --no-install <tool>`. v3 got there by resolving the workspace root (`WorkspaceRoot.find(process.cwd())`) and detecting the package manager (`PackageManagerDetector.detect(root)`), both from `@effected/workspaces`.

**Option A — keep the direct edge.** `@effected/workspaces` is **integrated** tier (it owns the `@pnpm/catalogs.*` quartet). Under [R2](../effect-standards.md#dependency-policy) tier 3 propagates, so `commands` would be integrated. That is not where the cost stops. The program plan puts `@effected/npm` → `commands` in [Phase 5](../../../plans/2026-07-25-github-split-master.md#phases) (`PackagePublish` over `commands`), and `@effected/npm` is depended on by `@effected/lockfiles` (**pure**) and `@effected/package-json` (**boundary**). One direct edge therefore drags **four** packages to integrated tier — including a pure one, which R1 exists to prevent — and installs pnpm's catalog engine into the tree of anyone who wanted to run `tar`. R2's transitive tax is the argument; the topology is what makes it decisive.

**Option B — invert the contract (RECOMMENDED).** `commands` declares a narrow contract it requires in `R`, and `@effected/workspaces` ships the layer that implements it. This is the [`@effected/npm` precedent](npm.md#resolver-contracts) exactly: npm is a **pure** package owning `CatalogResolver` / `WorkspaceResolver` — the contracts "a package.json-document library defines but cannot implement" — and workspaces implements them. The same shape, one seam over: `commands` defines what a *project-local execution context* is; workspaces knows how to *find* one.

The contract is deliberately smaller than "the workspaces surface". `commands` does not want a workspace root, a package-manager name, or a manifest — it wants **an argv prefix and a directory to run it in**:

```ts
// src/LocalExec.ts
export class ExecContext extends Schema.Class<ExecContext>("ExecContext")({
  /** Human label of the launcher, e.g. `"pnpm"`. Reporting only — no semantics attach. */
  label: Schema.String,
  /** argv prefix that runs a project-local binary, e.g. `["pnpm", "exec"]`. */
  prefix: Schema.Array(Schema.String),
  /** argv prefix that fetch-and-runs a package binary, e.g. `["pnpm", "dlx"]`. */
  dlxPrefix: Schema.Array(Schema.String),
  /** Directory the prefix must run in (the workspace root). Omitted means "the caller's cwd". */
  directory: Schema.optionalKey(Schema.String),
}) {
  /** Prefixes `command` and applies `directory`, returning a core `Command`. */
  apply(command: ChildProcess.StandardCommand): ChildProcess.Command;
  /** As {@link ExecContext.apply}, using `dlxPrefix`. */
  applyDlx(command: ChildProcess.StandardCommand): ChildProcess.Command;
}

export interface LocalExecShape {
  /**
   * The project-local execution context, or `Option.none()` when there is no
   * project-local way to run tools here. A *mechanism* failure (an unreadable
   * manifest) is the typed error; "no context" is `None`, never an error.
   */
  readonly context: Effect.Effect<Option.Option<ExecContext>, LocalExecError>;
}
```

`context` is a value that *is* an `Effect` — the core paradigm for "yielding is the natural verb" (`ChildProcessSpawner`'s `exitCode` is written the same way). The `None`-is-success / typed-error-is-mechanism-failure split is npm's resolver convention, adopted verbatim so the kit reads consistently.

**Three consequences worth stating.**

- **`commands` never touches a path or an ambient `cwd`.** The roadmap's port note ("v3 calls `process.cwd()` directly; v4 must parameterize that") is discharged not by threading a `cwd` parameter through every method, but by moving the entire question behind the contract. `@effected/workspaces` already owns the house `{ cwd }` convention (*"every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`; no service method reaches for the ambient cwd"*), so the ambient read lands in the one package that already has a policy for it — or in the application, at the edge, where it belongs.
- **The prefix table lives in `commands`, once.** `LocalExec.prefixes(manager)` is a pure static returning the four managers' `{ prefix, dlxPrefix }` pairs. Workspaces' layer calls it with the `DetectedPackageManager.name` it detected, so there is **no duplication of package-manager argv knowledge** — the detection lives in workspaces, the argv lives here, and neither reimplements the other.
- **A consumer with no monorepo pays nothing.** A GitHub Action running in a single-package checkout wires `LocalExec.layerNone` (global-only resolution) or `LocalExec.layerFor("npm")` and never installs `@effected/workspaces`. Under Option A that consumer installs the pnpm catalog engine to ask whether `tar` exists.

**Wiring, both ways, for comparison.**

```ts
// Option B (recommended) — monorepo-aware consumer
const AppLayer = ToolDiscovery.layer.pipe(
  Layer.provide(Workspaces.localExecLayer({ cwd: process.cwd() })), // shipped by @effected/workspaces
  Layer.provide(Workspaces.layer),
  Layer.provide(NodeServices.layer),
);

// Option B — action / single-package consumer (no workspaces install at all)
const AppLayer = ToolDiscovery.layer.pipe(
  Layer.provide(LocalExec.layerFor("npm")),
  Layer.provide(NodeServices.layer),
);

// Option A (rejected) — every consumer, always
const AppLayer = ToolDiscovery.layer.pipe(
  Layer.provide(Workspaces.layer), // PackageManagerDetector | WorkspaceRoot, + @pnpm/catalogs.* in the tree
  Layer.provide(NodeServices.layer),
);
```

Ergonomically the two are a wash for the monorepo consumer; the difference is entirely in what the *other* consumers pay, and in the tier of four packages. **Recommendation: Option B.** This supersedes the roadmap's "Peers on `@effected/workspaces`" line, which the roadmap itself already flags as a live choice ("the contract-inversion option remains available as a design choice but is not forced") — [roadmap.md](../roadmap.md#effectedcommands) needs a one-line reconciliation when this doc is accepted.

**The reciprocal edge.** `@effected/workspaces` takes a `workspace:~` edge on `@effected/commands` and ships `Workspaces.localExecLayer`. The graph stays acyclic: `commands` has no `@effected` edges at all, by construction.

## Module map and target surface

Module-per-concept, no barrels; `src/index.ts` re-exports only.

| Module | Owns |
| --- | --- |
| `src/Run.ts` | the structured run combinators (incl. `detach`), `CommandOutput`, `CommandFailedError`, `CommandOutputError` |
| `src/Redaction.ts` | value-based secret scrubbing + the secret-flag heuristic backstop |
| `src/Retry.ts` | transience classification and the retry policy (the resurrected `execWithRetry`, as vocabulary) |
| `src/LocalExec.ts` | the inverted contract: `LocalExec`, `ExecContext`, `LocalExecError`, the prefix table, layers |
| `src/Tool.ts` | `Tool`, `VersionProbe` variants, `ToolSource` / `MismatchPolicy` literals |
| `src/ToolDiscovery.ts` | the `ToolDiscovery` service + layer, `ResolvedTool`, `ToolNotFoundError`, `ToolVersionMismatchError` |
| `src/internal/` | version extraction, capture bounds, private spawn plumbing |

### `Run` — structured running over a core `Command`

```ts
export interface RunOptions {
  /** Ceiling for the whole run. Absent means no ceiling — a package-manager install is not a git probe. */
  readonly timeout?: Duration.Input | undefined;
  /** Values scrubbed out of captured output and out of any error, by exact match. */
  readonly redact?: ReadonlyArray<Redacted.Redacted<string>> | undefined;
  /** Cap on captured bytes per stream. Defaults to `Run.DEFAULT_MAX_OUTPUT_BYTES` (16 MiB). */
  readonly maxOutputBytes?: number | undefined;
}

export class CommandOutput extends Schema.Class<CommandOutput>("CommandOutput")({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
}) {}

/** Run to completion; collect stdout, stderr and exit code. A non-zero exit is NOT an error here. */
const collect: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<CommandOutput, CommandFailedError, ChildProcessSpawner>;

/** As `collect`, teeing both streams to `Stdio` as they arrive (the v3 `streaming: true`). */
const collectTee: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<CommandOutput, CommandFailedError, ChildProcessSpawner | Stdio>;

/** Trimmed stdout. A non-zero exit fails typed. */
const text: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<string, CommandFailedError, ChildProcessSpawner>;

/** Trimmed, non-empty stdout lines. A non-zero exit fails typed. */
const lines: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<ReadonlyArray<string>, CommandFailedError, ChildProcessSpawner>;

/** stdout parsed as JSON and decoded through `schema`. A non-zero exit fails typed. */
const json: <A, I>(command: ChildProcess.Command, schema: Schema.Codec<A, I>, options?: RunOptions) =>
  Effect.Effect<A, CommandFailedError | CommandOutputError, ChildProcessSpawner>;

/** The exit code. Never fails on a non-zero exit; a spawn failure or timeout still fails typed. */
const exitCode: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<number, CommandFailedError, ChildProcessSpawner>;

/** Did it run and exit zero? Never fails — the probe shape (`@effected/git`'s `available`, promoted). */
const succeeds: (command: ChildProcess.Command, options?: RunOptions) =>
  Effect.Effect<boolean, never, ChildProcessSpawner>;

/** Decoded stdout lines as they arrive, for output too large or too long-lived to collect. */
const stream: (command: ChildProcess.Command, options?: { readonly includeStderr?: boolean }) =>
  Stream.Stream<string, CommandFailedError, ChildProcessSpawner>;

/** Spawn, unref, return the pid — a child that outlives this process. See "Detached children". */
const detach: (command: ChildProcess.Command) =>
  Effect.Effect<ChildProcessSpawner.ProcessId, CommandFailedError, ChildProcessSpawner>;
```

Four decisions ride on this surface.

- **`RunOptions` carries only what a core `Command` cannot.** `cwd`, `env`, `extendEnv`, `stdin`, `shell`, kill signals and fd wiring are all `ChildProcess.CommandOptions` fields with core combinators (`setCwd`, `setEnv`); duplicating them in `RunOptions` would be exactly the re-declaration REVERSAL 2 punished. A caller writes `ChildProcess.make("tar", args).pipe(ChildProcess.setCwd(dir))` — core's vocabulary, unchanged. What is left is genuinely ours: a deadline, a redaction set, a capture bound.
- **Collection is concurrent, and that is load-bearing.** `collect` spawns scoped and reads `[stdout, stderr, exitCode]` under `{ concurrency: "unbounded" }`, verbatim from `@effected/git`'s `internal/run.ts`: sequential collection deadlocks the moment either OS pipe buffer fills. The dual-stream backpressure integration test comes along with the code (see [Testing](#testing)).
- **Teeing goes through core's `Stdio` service, never `process.stdout`.** `Stdio` declares `stdout()` / `stderr()` as `Sink`s and ships `Stdio.layerTest`; `collectTee` tees with `Stream.tapSink` while still collecting — the name is literal, and `tee` is what the operation is. `Stdio` therefore appears in `R` for the teeing variant **only** — a plain `collect` caller is not taxed with it, which is why this is a separate combinator rather than a boolean option: **an option cannot vary the `R` channel.**
- **Capture is bounded.** Unbounded collection of a child's output is a memory-exhaustion vector; `maxOutputBytes` (default 16 MiB) fails typed as `CommandOutputError` rather than dying, per the [input-hardening standards](../effect-standards.md#input-hardening-standards). Genuinely large output is `Run.stream`'s job.

### "Run a tool and parse it" is the shape to make fluent

The recurring consumer shape is not "run a command", it is "ask a tool a question and get a typed answer". `silk-runtime-action`'s package-manager cache-dir interrogation (`src/services/cache.ts`) is five variants of it, and `silk-release-action`'s `npm view <pkg> time --json` is a sixth. Both collapse onto `text` and `json`:

```ts
// npm config get cache / pnpm store path / yarn cache dir / bun pm cache
const cacheDir = yield* Run.text(ChildProcess.make("pnpm", ["store", "path"]), { timeout: "30 seconds" });

// deno info --json / npm view <pkg> time --json — decoded, not `JSON.parse` + a cast
const info = yield* Run.json(ChildProcess.make("deno", ["info", "--json"]), DenoInfo);
```

`text` trims; `json` parses **and decodes through a schema**, so the failure modes (`notJson`, `schema`) are distinguishable rather than one `reason` string. This is the fluency test for the package: if a consumer still writes `JSON.parse(output.stdout) as X`, `Run.json` failed.

### Detached children: core already does this, and the consumer did not know

`silk-runtime-action`'s `turbo-cache/lifecycle.ts` hand-rolls `node:child_process.spawn({ detached: true, stdio: ["ignore", fd, fd] })` + `child.unref()`, because "spawn something that outlives this process" reads like a thing core's scoped spawner cannot do. **It can.** Read against `@effect/platform-node-shared@4.0.0-beta.101`'s `NodeChildProcessSpawner`:

- `CommandOptions.detached` already exists and **defaults to `true` on non-Windows** (`false` on Windows).
- `ChildProcessHandle.unref` is not merely an event-loop refcount tweak. The backend tracks an `isReferenced` flag, and the `acquireRelease` **release checks it**: `if (!isReferenced) return Effect.void`. An unref'd child is therefore **not killed when its scope closes** — which is precisely the detached-outlives-parent semantics, expressed in core, with no `node:` import.

So `Run.detach` is a four-line helper — `Effect.scoped(spawn → handle.unref → handle.pid)` — and it earns its place not by doing work but by **encoding the invariant**: unref must happen before the scope closes, or the release kills the child. That ordering is exactly the kind of non-obvious fact that sends the next consumer back to `node:child_process`. It returns core's branded `ProcessId`.

**Two halves of that consumer's lifecycle are deliberately NOT ours**, and both have named homes:

- **Signalling a bare pid later.** The reap happens in a *different process* (Actions `main` → `post`), so there is no handle — only a pid that travelled through `ActionState`. Core's kill is a method on a handle; there is no "signal an arbitrary pid" contract, and providing one means a `node:process.kill` import, which a boundary package may not have. **Home: `@effected/github-actions`** (integrated, `@effect/platform-node` as a required peer per [program decision #10](../../../plans/2026-07-25-github-split-master.md#decisions-locked-2026-07-25-with-spencer)) — where the pid's `ActionState` round-trip already lives, and where the `pid <= 0` process-group guard belongs beside the state that can produce a `-1`. That guard is load-bearing safety, not a detail: `kill(-1)` / `kill(0)` signal the caller's own process group and would take out the runner.
- **Routing a detached child's output to a log file.** The consumer opens an fd and passes `stdio: ["ignore", out, out]` so failures stay diagnosable while the fds stay off the parent's pipes. Core cannot express this: `CommandOptions.stdout`/`stderr` accept `"pipe" | "inherit" | "ignore" | "overlapped" | Sink`, and the Node backend maps a `Sink` to `"pipe"` — an *in-process* consumer, which defeats detachment. `additionalFds` are pipes too, not file descriptors. This is an **upstream gap in core's `CommandOptions`**, and the one thing this package must not do about it is grow a backend. v1 answer: `stdout: "ignore"` with the detached child writing its own log, or `@effected/github-actions` doing the fd-level spawn on the platform package it already requires. Worth an upstream issue.

**Readiness polling is not in this package.** `waitForServer` polls an *HTTP endpoint*, not a process — no subprocess concept appears in it — and its implementation is already idiomatic core: `Effect.retry({ schedule: Schedule.spaced("150 millis"), times: 39 })` then `Effect.catch(() => Effect.succeed(false))`. There is no missing construct, only a missing idiom. The generic poll-until-predicate helper the survey found hand-rolled twice (also `silk-router-action`'s phase detector) is **already homed in `@effected/github-actions`** by the program plan's Phase 3 friction-fix list; nothing about it is command-shaped, and putting it here would make `commands` the junk drawer for "things consumers polled".

### Errors: two, both structurally routable

```ts
export class CommandFailedError extends Schema.TaggedErrorClass<CommandFailedError>()("CommandFailedError", {
  /** Why it failed, for structural routing (the `@effected/git` `kind` precedent). */
  kind: Schema.Literals(["nonZero", "spawn", "timeout"]),
  /** The executable. */
  command: Schema.String,
  /** argv, redacted. Never the raw values. */
  args: Schema.Array(Schema.String),
  exitCode: Schema.optionalKey(Schema.Number),
  stderr: Schema.optionalKey(Schema.String),
  stdout: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  static readonly nonZero: (...) => CommandFailedError;
  static readonly spawn: (command: ChildProcess.Command, cause: PlatformError) => CommandFailedError;
  static readonly timedOut: (command: ChildProcess.Command, after: Duration.Duration) => CommandFailedError;
  /** Executable-not-found: a spawn failure whose `PlatformError.reason._tag` is `"NotFound"`. */
  get notFound(): boolean;
  override get message(): string; // tail-truncated stderr, falling back to stdout
}

export class CommandOutputError extends Schema.TaggedErrorClass<CommandOutputError>()("CommandOutputError", {
  kind: Schema.Literals(["notJson", "schema", "tooLarge"]),
  command: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
```

- **Few mandatory fields, ergonomic statics** — the program's non-negotiable. Three required fields on the common error (`kind`, `command`, `args`), everything else optional, and every construction site goes through a static that fills the rest from the `Command` value it already has.
- **No `reason: string`.** v3's `CommandRunnerError` carried `reason` and consumers matched substrings on it (`native-version.ts`'s `TRANSIENT_REASONS.some((code) => reason.includes(code))`). `kind` plus the structured fields replace it; `message` is a rendering, never a routing surface.
- **Tail-truncated `message`.** v3's `MAX_OUTPUT_CHARS = 2000` tail-bound formatter is ported as-is and its reasoning with it: npm writes warnings first and the real error last, so truncating the head is the only useful direction.
- **`stdout` is carried alongside `stderr`** for the same v3-discovered reason — npm routes real errors to stdout often enough that dropping it hid causes.

### `Redaction` — value-based first, heuristic second

```ts
/** Replace every occurrence of each secret's value with `"***"`. Exact, no heuristics. */
const apply: (text: string, secrets: ReadonlyArray<Redacted.Redacted<string>>) => string;
/** As `apply`, over an argv array. */
const applyArgs: (args: ReadonlyArray<string>, secrets: ReadonlyArray<Redacted.Redacted<string>>) => ReadonlyArray<string>;
/** Backstop: redact any positional that is, or follows, a known secret-bearing flag. */
const scrubArgs: (args: ReadonlyArray<string>, options?: { readonly flags?: ReadonlyArray<string> }) => ReadonlyArray<string>;
/** The default flag table (`--token`, `--password`, `--otp`, `:_authToken`, …). */
const SECRET_FLAGS: ReadonlySet<string>;
```

v3 had only the heuristic (`scrubAuthArgs`), which is guesswork: it protects `--token <v>` and misses `--registry-key=<v>`. The v4 primary mechanism is **value-based** — the caller already holds its secrets as `Redacted.Redacted<string>` (core module, verified present), passes them in `RunOptions.redact`, and `Run` scrubs them from argv **and from captured stdout/stderr** before either reaches an error. The heuristic stays on by default as a backstop for secrets the caller forgot to declare. Both are exported because the program plan hoists npm's token masking to callers ([Phase 5](../../../plans/2026-07-25-github-split-master.md#package-topology)) — the callers need this vocabulary.

### `Retry` — the resurrected `execWithRetry`, as composable vocabulary

`silk-release-action/src/utils/native-version.ts` (lines ~38-41, 117-127) hand-rolls a transport-error classifier and a one-shot retry, with a comment saying it mirrors an upstream `execWithRetry` that was removed. The v4 answer is **not** a retrying runner method; core's `Effect.retry` already takes `{ while, schedule, times }` (verified in `Effect.ts`'s `Retry.Options`). What was missing is the *classifier*:

```ts
/** Transport-shaped failure: ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, "fetch failed", … */
const isTransient: (error: CommandFailedError) => boolean;
/** The default patterns, exported so a consumer can extend rather than fork. */
const TRANSIENT_PATTERNS: ReadonlyArray<string>;
/** Ready-made `Effect.retry` options: transient-only, jittered exponential, three attempts. */
const transient: (options?: { readonly times?: number; readonly also?: ReadonlyArray<string> }) =>
  { readonly while: (e: CommandFailedError) => boolean; readonly schedule: Schedule.Schedule<...>; readonly times: number };
```

Usage stays one line and stays the caller's: `Run.text(cmd).pipe(Effect.retry(Retry.transient()))`. A caller needing a reset between attempts (native-version's `git checkout -- . && git clean -fd`) composes `Effect.retryOrElse` or `Effect.tapError` itself — the reset is domain logic and does not belong in a retry policy.

### `Tool` and `ToolDiscovery`

```ts
// src/Tool.ts
export const ToolSource = Schema.Literals(["any", "global", "local", "both"]);
export const MismatchPolicy = Schema.Literals(["preferLocal", "preferGlobal", "fail"]);

export class VersionFlag extends Schema.TaggedClass<VersionFlag>()("VersionFlag", {
  flag: Schema.String,                          // default "--version"
  pattern: Schema.optionalKey(Schema.String),   // capture-group regex; default extracts the first version-shaped token
}) {}
export class VersionJson extends Schema.TaggedClass<VersionJson>()("VersionJson", {
  flag: Schema.String,
  path: Schema.String,                          // dotted path into the parsed object
}) {}
export class VersionNone extends Schema.TaggedClass<VersionNone>()("VersionNone", {}) {}
export const VersionProbe = Schema.Union([VersionFlag, VersionJson, VersionNone]);

export class Tool extends Schema.Class<Tool>("Tool")({
  name: Schema.String,                 // non-empty; must not begin with "-"
  version: VersionProbe,               // defaults to VersionFlag({ flag: "--version" })
  source: ToolSource,                  // defaults to "any"
  onMismatch: MismatchPolicy,          // defaults to "preferLocal"
}) {
  /** `Tool.named("biome")` — the 90% constructor. */
  static readonly named: (name: string, overrides?: Partial<...>) => Tool;
}
```

```ts
// src/ToolDiscovery.ts
export class ResolvedTool extends Schema.Class<ResolvedTool>("ResolvedTool")({
  name: Schema.String,
  source: Schema.Literals(["global", "local"]),
  version: Schema.Option(Schema.String),
  globalVersion: Schema.Option(Schema.String),
  localVersion: Schema.Option(Schema.String),
  mismatch: Schema.Boolean,
  /** The label of the launcher when `source` is `"local"`, e.g. `"pnpm"`. */
  launcher: Schema.optionalKey(Schema.String),
}) {
  /** A core `Command` that runs this tool — global argv, or prefixed via `ExecContext`. */
  command(...args: ReadonlyArray<string>): ChildProcess.Command;
}

export interface ToolDiscoveryShape {
  readonly resolve: (tool: Tool) =>
    Effect.Effect<ResolvedTool, ToolNotFoundError | ToolVersionMismatchError | LocalExecError>;
  readonly isAvailable: (tool: Tool) => Effect.Effect<boolean>;
  readonly invalidate: (tool: Tool) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
}

export class ToolDiscovery extends Context.Service<ToolDiscovery, ToolDiscoveryShape>()(
  "@effected/commands/ToolDiscovery",
) {
  static readonly layer: Layer.Layer<ToolDiscovery, never, ChildProcessSpawner | LocalExec>;
  static readonly makeTest: (overrides?: Partial<ToolDiscoveryShape>) => ToolDiscoveryShape;
  static readonly layerTest: (overrides?: Partial<ToolDiscoveryShape>) => Layer.Layer<ToolDiscovery>;
}
```

Every member of the shape is an `Effect` or a function returning one — the program's first non-negotiable, and what keeps the test double honest. `layer` is a `static readonly` const using `this`, resolving `ChildProcessSpawner` and `LocalExec` once at construction so every method's `R` is `never`.

**Five deliberate changes from v3**, each recorded because each drops something:

- **`require` is dropped.** v3's `require(definition, message?)` re-wrapped `ToolResolutionError` as `ToolNotFoundError` with a caller-supplied `reason: string`. The house forbids `reason: string` errors, and a caller wanting custom wording writes `Effect.mapError` at the call site. Failure is instead **structurally** distinguished: `ToolNotFoundError { tool, searched, source }` (nothing satisfying the source requirement) versus `ToolVersionMismatchError { tool, globalVersion, localVersion }` (`onMismatch: "fail"`).
- **Four resolution policies collapse to three.** v3's `Report` and `PreferLocal` produced identical results; the only difference was intent, and `ResolvedTool.mismatch` already reports the fact. `preferLocal` | `preferGlobal` | `fail`.
- **No shell, ever.** v3 probed global availability by spawning `sh -c` with a template string interpolating the tool name into `command -v <name>` — a tool name interpolated into a shell string, which is both an injection hazard and broken on Windows. v4 probes by **spawning the tool itself** with its version flag and reading the outcome: a `PlatformError` whose `reason._tag` is `"NotFound"` means absent; any completed run means present (`@effected/git`'s `available`, sharpened). This also halves the probe count — v3 ran `command -v` *and* `tool --version`.
- **Option-injection guard.** A tool `name` that is empty or begins with `-` is refused **before any spawn**, as a typed failure — the `@effected/git` guard, same reasoning: argv position zero is not a place to accept a flag.
- **`clearCache` becomes `invalidate` / `invalidateAll`.** A long-lived process that just installed a tool wants to forget one entry, not all of them.

### Caching: core `Cache`, keyed on evidence

v3 cached `ResolvedTool` values in a `Ref<Map<string, ResolvedTool>>` keyed by **tool name alone** — so two `Tool`s with the same name but different source requirements shared an entry and the second caller got the first's policy decision. Two fixes:

1. **Cache the evidence, apply the policy fresh.** The cached value is the probe outcome (global present? global version? local present? local version?), keyed by tool *name* — which is genuinely all the probe depends on. `source` and `onMismatch` are applied per call against that evidence, so a second `Tool` with different constraints gets the right answer without a second probe.
2. **Use core's `Cache`, not a bare `Ref`.** `Cache.makeWith(lookup, { capacity, timeToLive })` (verified in `.repos/effect`) gives in-flight de-duplication for free — two fibers resolving `biome` concurrently produce one probe, where a `Ref`-and-`Map` produces two. TTL is `Duration.infinity` for successes and zero for failures via the `timeToLive(exit, key)` function, so a transient probe failure is not memoized for the process lifetime. Bounded `capacity` (256) keeps it from being an unbounded map.

**Not `@effected/store`** (per the brief) and **not `Effect.cached`** — the workspaces lesson applies verbatim: `Effect.cached` memoizes the first `Exit` *including an interrupt*, permanently poisoning the entry with a cause outside the declared error channel.

**Open verification item:** whether core `Cache` has the same interrupt-poisoning property (it stores a `Fiber` per entry). This must be settled with a probe at implementation time — interrupt a lookup, then re-get — before the cache ships. If it does poison, the fallback is `Cache` plus an `Effect.onExit` invalidate-on-non-success, exactly as `@effected/workspaces` does around `cachedInvalidateWithTTL`.

## What this package deliberately does not do

This section is the design's spine, not an appendix. Each line is a thing a previous version of this package did, or a thing a reviewer will propose.

- **No `Command` type.** Core declares `ChildProcess.Command` / `StandardCommand` / `PipedCommand`, with `make` (three calling conventions, including template literals), `prefix`, `pipeTo`, `setCwd`, `setEnv`. This package consumes those values and never wraps them. In particular there is **no `ToolCommand` wrapper class** (silk-effects has one); `ResolvedTool.command(...)` returns a core `Command`, and the ergonomics that wrapper provided are `Run`'s free functions instead.
- **No runner service over subprocesses.** `ChildProcessSpawner` *is* that service. `Run` is a module of combinators requiring it in `R`, not a second `Context.Service` in front of it. There is no `CommandRunner` in this package and there must never be one.
- **No spawner backend, no platform layer.** No `node:child_process`, no Windows argument-escaping, no `.cmd` resolution — all of that is `@effect/platform-node`'s `NodeChildProcessSpawner`. If a backend behaves wrongly, the fix is upstream, not a shim here.
- **No package-manager detection.** Inverted to `LocalExec`; workspaces detects.
- **No PATH / `which` implementation.** Probing by spawn answers the only question we ask ("can this run?") without a filesystem scan, `PATHEXT` handling, or a `FileSystem` requirement. If a consumer ever needs the resolved *absolute path* of a tool, that is a new method with new evidence, not a v1 guess.
- **No shell helper.** A consumer running a configured command string (silk-update-action's `sh -c <command>`) builds `ChildProcess.make("sh", ["-c", str])` itself and owns the injection surface; core also exposes `CommandOptions.shell`. Wrapping that would launder the risk into our name.
- **No process supervision.** `Run.detach` hands back a pid and stops there. No signalling a bare pid, no process-group handling, no liveness registry, no pid persistence — see [Detached children](#detached-children-core-already-does-this-and-the-consumer-did-not-know); the reap half is `@effected/github-actions`'.
- **No readiness or poll-until-predicate helper.** Core's `Effect.retry({ schedule, times })` is the construct; the Actions-shaped helper is `@effected/github-actions`'.
- **No file-descriptor plumbing.** Routing a detached child's output to a log file is an upstream `CommandOptions` gap, not a hole for this package to patch with a backend.
- **No archive/tar helper in v1** — see below.
- **No `./testing` subpath, no behavior-reimplementing doubles.** `makeTest` / `layerTest` on the service, dying loudly on anything unstubbed.
- **No ambient `cwd`, no `process.env` reads, no `node:` imports.**

### The tar/archive call: defer, with a trigger

`silk-release-action/src/release/meta-archive.ts` shells `tar -czf <out> -C <parent> <dir>` through `CommandRunner`. **Recommendation: do not ship an archive helper in v1.**

- Against shipping it: `tar` is just a tool, and after this package the call site is already two clear lines (`Tool.named("tar")` + `Run.collect`). A helper that only re-spells those two lines earns nothing.
- The real reason to defer: an honest archive API is **not** a `tar` wrapper. It has to answer determinism (mtimes, uid/gid, entry order — a release asset that changes hash between identical builds defeats the attestation story `@effected/sbom` is being built for in Phase 4), `bsdtar`-vs-GNU-`tar` flag divergence on macOS and Windows runners, exclusion patterns, and whether extraction is in scope. Shipping `tarMetaFolder` under `@effected/commands` would sink that design into the wrong package and make it a breaking change to move.
- **Trigger to revisit:** a second consumer needing archives, *or* Phase 4's attestation work needing byte-reproducible artifacts. At that point it is `@effected/archive` (its own design doc), not a method here. `commands` is what it would be built on.

## Observability

Per the [observability standards](../effect-standards.md#observability-standards): named spans, telemetry-agnostic, no SDK construction.

- Every public fallible boundary is `Effect.fn("Run.collect")`, `Effect.fn("ToolDiscovery.resolve")`, and so on.
- Span attributes are **stable identifiers only**: the executable name, `argc`, the resulting `exitCode`, the tool name and resolved source. **Never argv values and never captured output** — argv is where secrets appear, which is the whole premise of `Redaction`.
- **No metrics in v1.** The v3 `CommandRunner` incremented a `commandExecutions` counter attributed by full command string — unbounded cardinality decided by a library, for a consumer who pays the bill. `@effected/git` sets the house precedent (spans, no metrics). If a consumer wants a counter, the span is already there to derive it from.
- Logging: none inside the combinators. Consumers log at their own operation boundaries.

## Testing

`@effect/vitest`, `it.effect` as the default, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit, mocked spawner.** `Layer.succeed(ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))` with `ChildProcessSpawner.makeHandle({...})` over in-memory streams — the `@effected/git` pattern, which needs no platform package. This carries the weight: exit-code routing, timeout, capture bound, redaction of both argv and captured output, `Run.json`'s three failure modes.
- **`collectTee` tests use `Stdio.layerTest({ stdout: … })`** — core ships the test layer, so no platform package and no `process.stdout` interception.
- **`ToolDiscovery` matrix over `LocalExec.layerTest` + a counting mock spawner:** the full (global present × local present × `source` × `onMismatch`) grid, the `None`-local case, version extraction across `VersionFlag` / `VersionJson` / `VersionNone`, and — via the probe counter — that a second `resolve` of the same tool spawns nothing, that `invalidate` re-probes, and that two concurrent resolves probe **once**.
- **Property test on redaction.** `it.effect.prop` over arbitrary secrets and argv: no rendered error message, no `args` array and no captured stream ever contains a secret's value. This is the one invariant where a counterexample is a security bug, so it gets a property rather than examples.
- **Integration (`@effect/platform-node`, devDependency):** a real `node --version` probe; a nonexistent executable pinning `PlatformError.reason._tag === "NotFound"` (the whole "absent" classification rests on that mapping, which is platform-backend behavior, not core's contract); and **the dual-stream backpressure test**, inherited from `@effected/git` — a mock spawner over in-memory streams cannot deadlock the way a real OS pipe can, so it is the only regression guard on `{ concurrency: "unbounded" }`. Do not delete it here either.
- **Integration: `Run.detach` survives its scope.** Spawn a sleeper, close the scope, assert the process is **still alive** (then reap it in teardown), and assert the mirror case — a spawn *without* the unref is killed on scope close. This pins the `isReferenced` release behavior, which is platform-backend behavior this package's whole detached story rests on, and it is the test that fails loudly if a future backend release changes it.
- **Mutate-the-edges discipline** before declaring green: flip the concurrency option, the capture bound, the redaction pass and the unref-before-scope-close ordering, and confirm the suite goes red.

Build: `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized bases of every `Schema.Class` / `TaggedClass` / `TaggedErrorClass` / `Context.Service` export; never widen it. Gate on `pnpm build --filter @effected/commands`, never the raw script.

## Consumers

- **`@effected/npm`** (Phase 5) — `PackagePublish` runs `npm publish` through `Run`, with the publish token in `RunOptions.redact`.
- **`@effected/workspaces`** — implements `LocalExec` (`Workspaces.localExecLayer`); takes the only inbound edge.
- **`@effected/github-actions`** (Phase 3) and the six consumer repos — the `CommandRunner` replacement: git plumbing through `@effected/git` where a typed method exists, everything else through `Run`. It also owns the two halves of `silk-runtime-action`'s detached-server lifecycle this package declines (pid reaping, readiness polling) and inherits `Run.detach` for the spawn half.
- **`silk-runtime-action`** — the sixth consumer ([survey](../../../plans/2026-07-25-silk-runtime-action-survey.md)): package-manager cache-dir interrogation through `Run.text` / `Run.json`, the detached turbo-cache server through `Run.detach`, and the deletion of its hand-rolled `node:child_process` spawn.

## As built (2026-07-25)

Implemented on `feat/upstream`: five source modules plus `internal/capture.ts`, 103 unit tests and 8 e2e tests, `tsc --noEmit` clean, and a prod `issues.json` of **0 warnings / 0 errors / 15 suppressed** (all synthesized `_base` symbols; the narrow house suppression). Two genuine `ae-unresolved-link` warnings were **fixed rather than suppressed** — a schema-declared `Schema.Class` field and a member of a service *shape interface* are both un-linkable by `{@link}` selector, so they became backticks.

**Where the build departed from the design, and why.**

- **`collect` returns `CommandFailedError | CommandOutputError`, not `CommandFailedError` alone.** The design said both "collect fails with `CommandFailedError`" and "the capture bound fails as `CommandOutputError`", which cannot both hold. Resolved toward the latter: an overflow is genuinely "the command ran, its output is unusable", which is what `CommandOutputError` means and where `notJson`/`schema` already live.
- **`ToolRefusedError` is a third tool error.** The design said an option-like tool name "fails typed" without naming the error. `ToolNotFoundError` would have been a lie (the tool may well exist) and reusing a `kind` discriminant on it would have blurred absence with refusal, so refusal is its own tag — the `@effected/git` `kind: "refused"` reasoning, expressed as a separate error because this package's not-found error carries a `searched` list that a refusal has no answer for.
- **The evidence cache is keyed by `(name, version probe)`, not by name.** Probing `biome --version` and `biome -V` are different probes; keying by name alone would have handed one Tool's evidence to a Tool that asks a different question. The key is a `Schema.Class`, whose structural `Equal`/`Hash` the cache's `MutableHashMap` uses — verified at beta.101 including nested union members — so the key carries the probe itself and the lookup needs no side table. (The first implementation used a name key plus a `Map` side table; it worked and read badly, and the probe replaced it.)
- **Absence is not memoized.** Designed as `Exit.isSuccess ? infinity : zero`; as built, `Duration.infinity` requires a success **that found the tool somewhere**. "Not found" is a *successful* lookup carrying negative evidence, so the designed rule would have made a tool installed mid-process — an action that provisions a runtime and then uses it — permanently absent. Found by a test written from the design's own intent, which failed against the design's own TTL rule.
- **`LocalExec.makeTest` defaults honestly instead of dying loudly.** The kit's `makeTest` convention is that an unstubbed member dies. Here the contract has exactly one member whose *correct, real* answer is `Option.none()` ("no project-local context"), so the double defaults to it and a test that does not care about local resolution gets global-only behavior. `ToolDiscovery.makeTest` keeps the loud default, because none of its members has an honest one.
- **`Tool.named(name, overrides?)`** is the ergonomic constructor (`Tool.make` remains, from the schema class). Named rather than `of` because it reads as a sentence at the call site.

**Facts established by probe, worth not re-deriving:**

- Core `Cache` does **not** share `Effect.cached`'s interrupt-poisoning property. A control reproducing the poisoning on `Effect.cached` ran first, so the negative result is meaningful: an interrupted lookup is discarded and re-run (`lookups: 2`), where `Effect.cached` returns the memoized interrupt forever.
- Core `Cache` **does** memoize a *failed* lookup for the entry's TTL by default — the reason the `timeToLive` function is load-bearing rather than decorative.
- Two concurrent `Cache.get`s for one key run **one** lookup. This is the measured basis for choosing `Cache` over `Ref` + `Map`, which was an assertion in the design.
- The Node backend's `acquireRelease` release checks an `isReferenced` flag and **skips the kill** for an unref'd child, which is what makes `Run.detach` possible without a backend of our own.

**Mutation-tested claims** (each mutant run, observed red, reverted): the `unref` ordering in `detach`; success-path output redaction; the capture byte bound; the pre-spawn option-injection guard; and `{ concurrency: "unbounded" }` — which deadlocks for real under the e2e backpressure test, confirming that test discriminates rather than merely passing.

## Decisions recorded

Every design question raised during this round was ruled on at the 2026-07-25 checkpoint; none is outstanding. Each entry records the ruling **and** the reasoning, so implementation does not have to re-derive it and a later reader can tell a decision from a default.

- **The teeing variant is named `collectTee`** (2026-07-25). It stays a **separate combinator**, not a `collect` option, for a typed reason rather than a stylistic one: only it requires core `Stdio` in `R`, and an options field cannot vary the `R` channel — a boolean would tax every plain `collect` caller with a `Stdio` requirement they never use. `tee` is also the precise word for what it does (`Stream.tapSink` while still collecting), which `echo` and `streaming` only gesture at.
- **`Run` stays free functions, not a service** (2026-07-25). A `Context.Service` in front of `ChildProcessSpawner` is the REVERSAL 2 trap in its exact original shape — core's spawner *is* the runner service, and wrapping it in a second one is the re-declaration that killed the first package. The accepted cost: a consumer cannot stub `Run` semantically and instead stubs the spawner with `Layer.succeed(ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))`, the `@effected/git` pattern that needs no platform package.
- **Version constraints (`Tool.range`) stay deferred** (2026-07-25). The hazard is asymmetric: refusing a tool that works, because its `--version` prints `tar (GNU tar) 1.35` rather than a bare semver, is a worse failure than not checking a range at all. The `@effected/semver` edge is pure-tier and therefore free whenever it is wanted, so this can arrive **additively** on a consumer's demand without reshaping anything here.
- **`ToolDiscovery` and `Run` stay one package** (2026-07-25). Program decision #2 reconfirmed — they were designed together, `ToolDiscovery` is `Run`'s first consumer, and nothing in the design round argued for a split.
- **`Run.detach` ships as API** (2026-07-25). Four lines over core, kept because it encodes the unref-before-scope-close ordering invariant — and because a consumer that did not know core could do this at all regressed to a raw `node:child_process` spawn, which is the demand evidence. The two-way `isReferenced` integration test (unref'd survives scope close; non-unref'd is killed) ships with it and is not optional.
- **`RunOptions.timeout` stands — a deliberate reversal of the pivot plan's ruling** (2026-07-25). The superseded plan's *"no timeout parameter anywhere: callers compose `Effect.timeout`"* was written for a backend-plus-two-helpers package and does not survive a generic runner: `pnpm install` and `git rev-parse` cannot share a default. Two things make the reversal safe rather than a regression. The option has **no default**, so the helper still imposes no policy — a caller who says nothing gets no ceiling. And it earns its keep on the error channel, not the deadline: bare `Effect.timeout` fails with core's `Cause.TimeoutError`, widening every caller's channel with a non-domain error, whereas `Run` absorbs it into `CommandFailedError { kind: "timeout" }` — the same absorption `@effected/git`'s `runClassified` performs so consumers only ever see git's taxonomy. See [the divergences](#two-places-this-design-knowingly-diverges-from-the-superseded-plans).
- **No upstream Effect issue yet for the detached-child log fd** (2026-07-25). The gap is recorded [above](#detached-children-core-already-does-this-and-the-consumer-did-not-know) as a **candidate upstream issue**: core's `CommandOptions` cannot route a detached child's stdout/stderr to a file descriptor (`"pipe" | "inherit" | "ignore" | "overlapped" | Sink`, and the Node backend maps a `Sink` to `"pipe"`, which defeats detachment). Filing is Spencer's call at session end; nothing in this design waits on it.

## Open questions

**None.** Every question this design round raised was ruled on at the 2026-07-25 checkpoint and moved into [Decisions recorded](#decisions-recorded) with its reasoning. The design is ready to implement.

Two items are tracked but are **not** open questions against this design, because neither blocks or reshapes it: the [candidate upstream issue](#decisions-recorded) for core's detached-child file-descriptor gap (filing is Spencer's call), and the implementation-time probe of whether core `Cache` shares `Effect.cached`'s interrupt-poisoning property (settled with a probe before the cache ships, with the `Effect.onExit`-invalidate fallback already identified — see [Caching](#caching-core-cache-keyed-on-evidence)).
