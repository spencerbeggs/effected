---
name: running-commands-and-tools
description: Use when running a subprocess in Effect v4, spawning a command, capturing stdout/stderr/exit code, checking whether a CLI tool is installed or which copy (global vs. project-local) to run, running git/pnpm/npm/npx from Effect, running a package.json script through the project's launcher, detaching a background process that must outlive its scope, or redacting a secret from argv or captured output. Covers @effected/commands' Run combinators (collect/collectTee/text/lines/json/exitCode/succeeds/stream/detach), ToolDiscovery's resolution and evidence cache, the LocalExec contract inversion with its exec/dlx/script prefixes (ExecContext.apply/applyDlx/applyScript), and the Redaction/Retry vocabulary — all built over core's ChildProcess/ChildProcessSpawner, never reimplementing it.
---

# Running commands and finding tools

Verified against `packages/commands/src/{Run,Tool,ToolDiscovery,LocalExec,Redaction,Retry}.ts` and
`.repos/effect/packages/effect/src/unstable/process/{ChildProcess,ChildProcessSpawner}.ts` at
`effect@4.0.0-beta.101`. `@effected/commands` is the kit's tool-and-output layer over core's
subprocess contract: **`Run`** turns a core `ChildProcess.Command` into typed structured output;
**`ToolDiscovery`** answers "is this tool here, and which copy should I run?" Both are boundary
tier — `effect` is the only peer, zero `@effected/*` edges, zero `node:` imports.

## The one rule this package exists to obey

> Every subprocess concept here is core's, and no implementation of one is.

A previous `@effected/commands` was deleted for violating this **twice** — name the two failure
modes separately, because a single "don't reinvent core" rule approves the second one:

1. **Inventing the vocabulary.** A `Command` type, a `CommandRunner` service, a
   `CommandSpawnError` — core's `effect/unstable/process` already declares `ChildProcess.Command`
   and the `ChildProcessSpawner` service; see `effect-v4-module-index`'s subprocess row.
2. **Owning the implementation.** Importing core's vocabulary faithfully and then **porting a
   spawner backend into the package anyway** — `node:child_process`, Windows argument-escaping,
   `.cmd` resolution. That is a platform layer, and shipping one is exactly what killed the
   second attempt even though it spoke core's types throughout.

Never add, in this package or a lookalike: a `Command` type, a service wrapping
`ChildProcessSpawner`, a spawner backend, a platform layer, a `node:child_process` import, or a
shell helper (`sh -c` with an interpolated tool name). **`Run` is free functions, not a service**,
for exactly this reason — core's spawner already *is* the runner service.

## `Run` — routing table

All nine combinators take a core `ChildProcess.Command` plus optional `RunOptions`, and require
`ChildProcessSpawner` in `R` (`collectTee` additionally requires `Stdio`):

| Question | Combinator | Non-zero exit |
| --- | --- | --- |
| Collect stdout, stderr, exit code | `Run.collect` | a **result**, not an error |
| As `collect`, teeing both streams to `Stdio` live | `Run.collectTee` | a **result** |
| Trimmed stdout | `Run.text` | typed `CommandFailedError` |
| Trimmed, non-empty stdout lines | `Run.lines` | typed `CommandFailedError` |
| stdout parsed as JSON and schema-decoded | `Run.json` | typed `CommandFailedError` |
| Just the exit code | `Run.exitCode` | a **result** |
| Did it run and exit zero? | `Run.succeeds` | never fails — `false` |
| Decoded stdout lines as they arrive | `Run.stream` | typed failure on the stream |
| Spawn, unref, return the pid | `Run.detach` | typed failure only if it never started |

```ts
import { Run } from "@effected/commands";
import { ChildProcess } from "effect/unstable/process";

// npm config get cache / pnpm store path / yarn cache dir — Run.text over Run.json
const cacheDir = yield* Run.text(ChildProcess.make("pnpm", ["store", "path"]), { timeout: "30 seconds" });

const info = yield* Run.json(ChildProcess.make("deno", ["info", "--json"]), DenoInfo);
```

If a consumer still writes `JSON.parse(output.stdout) as X`, reach for `Run.json` instead — it
decodes through a `Schema.Codec` and distinguishes `"notJson"` from `"schema"` failures rather than
one `reason` string.

### Trap 1 — a non-zero exit is a RESULT, not an error, for exactly three combinators

`collect`, `exitCode` and `succeeds` report the exit code — core's own contract: `handle.exitCode`
(`ChildProcessSpawner.ts:89`) succeeds with any code. `text`, `lines` and `json` treat a non-zero
exit as a typed `CommandFailedError` (`kind: "nonZero"`) via the internal `requireZero` gate
(`Run.ts:298-303`). The split is deliberate — do not "fix" either half.

### Trap 2 — `{ concurrency: "unbounded" }` in `collectRaw` is load-bearing

`Run.ts:260-263` reads `[stdout, stderr, exitCode]` under `Effect.all(..., { concurrency:
"unbounded" })`. Collecting the two streams sequentially **deadlocks** the moment either OS pipe
buffer fills: the child blocks writing to a full pipe while the reader that would drain it is
still waiting on the other stream. Flipping it to `{ concurrency: 1 }` makes
`__test__/e2e/Run.e2e.test.ts`'s dual-stream backpressure test hang to its 30s timeout. A mocked
spawner over in-memory streams **cannot** reproduce this — pressure has to be on both OS pipes at
once — which is why that e2e test must never be deleted, and why a unit-only suite can never stand
in for it.

### Trap 3 — `collectTee` is a separate combinator, not an option

Only `collectTee` requires core `Stdio` in `R` (`Run.ts:316-320`, teeing with `Stream.tapSink`
against `stdio.stdout()` / `stdio.stderr()`). An **option cannot vary the `R` channel** — a boolean
`{ echo: true }` on `collect` would tax every plain caller with a `Stdio` requirement it never
uses. `tee` is also the literal word for what it does: it still collects while echoing.

### Trap 4 — `Run.detach`: unref BEFORE the scope closes

```ts
const detach = Effect.fn("Run.detach")(function* (command: ChildProcess.Command) {
 yield* annotate(command);
 return yield* Effect.scoped(
  Effect.gen(function* () {
   const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
   const handle = yield* spawner.spawn(command);
   yield* handle.unref; // MUST run before this scope closes
   return handle.pid;
  }),
 ).pipe(Effect.catch((error) => Effect.fail(CommandFailedError.spawn(command, error))));
});
```

(`Run.ts:371-385`.) The Node backend tracks an `isReferenced` flag and its scoped release **skips
the kill** for an unref'd child — so the ordering is the entire point. Reversed, the child dies
with the scope. `__test__/e2e/Run.e2e.test.ts`'s `Run.detach lifecycle` suite pins this **both
ways**: an unref'd child survives 250ms past scope close (reaped manually in the test's `finally`),
and a plain scoped spawn with no unref is dead by the same point — the survival half alone would
pass even if scope close never killed anything.

**Not in this package, both with named homes:** signalling a bare pid later (no handle survives an
Actions main→post process boundary; needs `node:process.kill`, which a boundary package may not
import — home: `@effected/github-actions`'s `DetachedProcess`, point at `actions-state-and-secrets`)
and routing a detached child's output to a log file (core's `CommandOptions.stdout` /
`.stderr` accept only `"pipe" | "inherit" | "ignore" | "overlapped" | Sink`, and the Node backend
maps a `Sink` to `"pipe"`, which defeats detachment — an upstream gap, not a hole to patch with a
backend here).

### Trap 5 — `RunOptions` carries only what a core `Command` cannot

```ts
export interface RunOptions {
 readonly timeout?: Duration.Input | undefined;   // no default
 readonly redact?: ReadonlyArray<Redacted.Redacted<string>> | undefined;
 readonly maxOutputBytes?: number | undefined;    // default Run.DEFAULT_MAX_OUTPUT_BYTES (16 MiB)
}
```

(`Run.ts:34-57`.) `cwd`, `env`, `extendEnv`, `stdin`, `shell` and kill signals are core
`ChildProcess.CommandOptions` fields with core combinators — build them with `ChildProcess.make`,
`ChildProcess.setCwd`, `ChildProcess.setEnv`, never re-declare them on `RunOptions`. **One trap in
that routing: bare `ChildProcess.setEnv` never sets `extendEnv`, and the Node spawner resolves the
child env as `extendEnv ? { ...process.env, ...env } : env` — so `setEnv({ VAR: x })` alone spawns
a child whose ENTIRE environment is that one variable (no `PATH`, no `HOME`; "tool cannot find its
own binary" at runtime).** A hermetic env is almost never what an action wants — route "add env
vars on top of the parent environment" through `Run.extendEnv({ VAR: x })`, which merges like
`setEnv` (new values win) and forces `extendEnv: true`, recursing into pipelines. Reserve bare
`setEnv`/construction options for a deliberately hermetic environment. `timeout` has
**no default**: an `npm install` and a `git rev-parse` cannot share a ceiling, and expiry folds into
`CommandFailedError { kind: "timeout" }` rather than widening every caller's error channel with
core's `Cause.TimeoutError`. `redact` and `maxOutputBytes` are covered below and in Trap 2's
neighbor, the capture bound (`CommandOutputError { kind: "tooLarge" }` on overflow — a memory-
exhaustion guard, not a re-declaration).

### Trap 6 — `Run.text` trims; that silently corrupts column-oriented output

`Run.text` returns `checked.stdout.trim()` (`Run.ts:328-333`) — trimmed
**leading and trailing** whitespace, not just a trailing newline. That is the
right shape for "the value of one line of output" and the wrong shape for
anything whose columns start with whitespace: `git status --porcelain`'s
leading-space status column is exactly this shape (`" M path/to/file"` — the
leading space is the "unmodified in the index" status, not padding).
`Run.text` silently eats it, and a caller that substring-parses the result
into status and path reads the wrong path for every entry whose status
column was a space. Route fixed-column, whitespace-significant output through
`Run.collect` instead — its `CommandOutput.stdout` is untrimmed — and parse
`output.stdout` directly, never `Run.text`'s return value, whenever column
position carries meaning.

## Errors: `CommandFailedError` and `CommandOutputError`

`CommandFailedError` (`kind: "nonZero" | "spawn" | "timeout"`) is "the command could not be run, or
ran and failed"; its `.notFound` getter (`this.kind === "spawn" && cause.reason._tag ===
"NotFound"`) is the structural "tool is not installed" signal — `ToolDiscovery` and `Retry` both
read it. `CommandOutputError` (`kind: "notJson" | "schema" | "tooLarge"`) is "the command ran, but
its output is unusable" — a genuinely separate condition, because the process itself succeeded.
Both carry `command`/`args` **redacted** and a tail-truncated `message` (`Run.ts:100-105` — tools
write warnings first and the real error last, so truncating from the head, not the tail, keeps the
useful part).

## `ToolDiscovery` — absence is a spawn failure, never an exit code

A tool whose `--version` exits 1 still **exists**. `ToolDiscovery` decides presence by whether the
process **ran**, so there is no `command -v` probe: a prior version interpolated the tool name into
`sh -c`, an injection hazard and broken on Windows. `probeLocation` (`ToolDiscovery.ts:202-209`)
spawns the tool with its version flag through `Run.collect` and reads presence off whether that
call succeeds at all, never off the exit code.

```ts
import { Tool, ToolDiscovery } from "@effected/commands";

const biome = Tool.named("biome");                              // --version, source: "any", preferLocal
const localOnly = Tool.named("biome", { source: "local" });
const strict = Tool.named("deno", { version: VersionJson.make({ flag: "info --json", path: "deno.version" }) });

const discovery = yield* ToolDiscovery;
const resolved = yield* discovery.resolve(biome);                // ToolNotFoundError | ToolVersionMismatchError | ToolRefusedError | LocalExecError
yield* Run.text(resolved.command("check", "."));                 // ResolvedTool.command returns a core Command
```

`VersionProbe` is a union of three tagged classes (`Tool.ts:47-92`):

| Variant | Asks | Fields |
| --- | --- | --- |
| `VersionFlag` | Run a flag, regex the version out of stdout | `flag` (default `--version`), optional `pattern` (first capture group; a default pattern covers `Version: 2.3.1 (build …)` / `v22.1.0` with no config) |
| `VersionJson` | Run a flag, read a dotted path from parsed JSON | `flag`, `path` (e.g. `"deno.version"`) |
| `VersionNone` | Presence only, no version | — |

`ToolSource` is `"any" | "global" | "local" | "both"` (default `"any"`, preferring local when
both are found); `MismatchPolicy` is `"preferLocal" | "preferGlobal" | "fail"` (default
`"preferLocal"`) — the policy for when the global and project-local copies disagree on version,
surfaced regardless of policy via `ResolvedTool.mismatch`. Three resolution errors are structural,
never a `reason: string`: `ToolNotFoundError { tool, searched }` (nothing satisfying `source`),
`ToolVersionMismatchError { tool, globalVersion, localVersion }` (`onMismatch: "fail"` and they
disagree), `ToolRefusedError { tool }` (an empty name, or one starting with `-` — refused
**pre-spawn**, `ToolDiscovery.ts:284-286`, because argv position zero is not a place to accept a
flag).

### The evidence cache caches probe evidence, not resolved answers

The cache key is `(name, version probe)` as a `Schema.Class` (`EvidenceKey`, `ToolDiscovery.ts:162-
165`), not the tool name alone — its structural `Equal`/`Hash` is what the cache's
`MutableHashMap` uses, verified at beta.101 including nested union members, so the key carries the
probe itself with no side table. `source` and `onMismatch` are applied **per call** against the
cached evidence, so a second `Tool` with different policy on the same name gets the right answer
with no second probe.

Two TTL traps live in one `timeToLive` function (`ToolDiscovery.ts:273-274`), both probed at
beta.101:

1. Core `Cache` memoizes a **failed** lookup for the entry's TTL by default — one transient probe
   failure would stick for the process lifetime.
2. "Not found" is a **successful** lookup carrying negative evidence — memoized, a tool installed
   mid-process (an action that provisions a runtime, then uses it) stays absent forever.

So only a result with `global.found || local.found` gets `Duration.infinity`; everything else gets
`Duration.zero`. *A tool that exists does not stop existing; a tool that does not exist very often
starts to.* Core `Cache` does **not** share `Effect.cached`'s interrupt-poisoning: an interrupted
lookup is discarded and re-run, verified with a control that reproduced the poisoning on
`Effect.cached` first before trusting the negative result on `Cache`.

## `LocalExec` — the contract inversion

`commands` **declares** `LocalExec`; `@effected/workspaces` **implements** it
(`Workspaces.localExecLayer`). The decisive argument is topological, not stylistic: a direct
`@effected/workspaces` edge would make `commands` integrated tier, and the planned
`@effected/npm` → `commands` edge would drag `npm`, `lockfiles` (pure!) and `package-json` up a
tier with it. `commands` wants only "an argv prefix and a directory to run it in" — not a
workspace root, a package-manager name, or a manifest:

```ts
export interface LocalExecShape {
 readonly context: Effect.Effect<Option.Option<ExecContext>, LocalExecError>;
}
```

`ExecContext` (`LocalExec.ts:70-110`) carries `label` (reporting only — nothing branches on it),
`prefix`, `dlxPrefix`, `scriptPrefix`, optional `directory`; `.apply(command)` /
`.applyDlx(command)` / `.applyScript(command)` prefix a core `StandardCommand` and apply
`directory` via `ChildProcess.prefix` / `ChildProcess.setCwd` — all return **new** command values,
never mutating the caller's. For `applyScript` the command's `command` is the **script name** and
its `args` are the script's arguments. `LocalExec.prefixes(launcher)` (returning the
`LauncherPrefixes` record: `prefix` / `dlxPrefix` / `scriptPrefix`, `LocalExec.ts:35-48,183`) is
the one place the four managers' argv lives (`npx --no --` / `pnpm exec` / `yarn exec` / `bun x
--no-install`, plus each `dlxPrefix`, plus each `run` form as `scriptPrefix`;
`LocalExec.scriptPrefix(launcher)` picks the one row, `:196`) — `npm`'s `--no` and bun's
`--no-install` both refuse to silently install a missing binary. **npm's `scriptPrefix` is
`["npm", "run", "--"]`, trailing `--` included**: bare `npm run <script> --flag` silently CLAIMS
`--flag` for npm itself and delivers nothing to the script (probed live at npm 11;
`npm run -- <script> --flag` delivers it) — the other three managers forward post-script
arguments without it (`LocalExec.ts:46-58`).

A single-package consumer never installs `@effected/workspaces`:

```ts
const AppLayer = ToolDiscovery.layer.pipe(
 Layer.provide(LocalExec.layerFor("npm")),  // or LocalExec.layerNone for global-only
 Layer.provide(NodeServices.layer),
);
```

**`Option.none()` is a real answer, never an error.** "No project-local way to run tools here" is
`Option.none()` from `context`; `LocalExecError` is reserved for a genuine mechanism failure (an
unreadable manifest). This is the same `None`-is-success convention `@effected/npm`'s resolver
contracts use.

**`LocalExec.makeTest` is the recorded exception to the die-loudly test-double rule.** Its one
member defaults to `Option.none()` rather than dying, because "no project-local context" *is* the
honest global-only answer — not a fabrication. `ToolDiscovery.makeTest` keeps the loud default:
every one of its members dies naming itself when unstubbed, because none of them has an honest
default (a fabricated `ResolvedTool` would leak into consumer logic as fact). The test for
admissibility is "would a real implementation legitimately answer this?", not "is it convenient" —
point at `testing-actions` for the fuller doctrine.

## `Redaction` — the kit-wide policy home

```ts
import { Redaction } from "@effected/commands";

const args = Redaction.applyArgs(rawArgs, [npmToken]);           // by VALUE — exact match, wherever it appears
const scrubbed = Redaction.scrubArgs(args);                      // heuristic backstop, runs in ADDITION
```

`apply` / `applyArgs` redact **by value**: the caller already holds its secret as
`Redacted.Redacted<string>`, and every occurrence is removed — whichever flag carried it, and
inside a larger string (`--url=https://u:s3cr3t@host`). Matching is longest-value-first
(`Redaction.ts:48-49`) — redacting a short secret before a longer one that contains it would leak a
fragment. `scrubArgs`'s flag heuristic (`SECRET_FLAGS`: `--token`, `--password`, `--otp`,
`:_authToken`, …) is the **backstop**, for a secret the caller forgot to declare — it runs in
addition to value-based redaction, never instead of it. `Run` applies both to argv and to captured
stdout/stderr before either reaches an error (`Run.ts:90-98`); span annotations carry only stable
identifiers (`command`, `argc`) — never argv values or captured output.

## `Retry` — vocabulary, not a runner

```ts
Run.text(command).pipe(Effect.retry(Retry.transient()));
```

`Retry.isTransient` classifies a `CommandFailedError` as a transport hiccup — matched against
`TRANSIENT_PATTERNS` (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `fetch failed`, …) in
stderr, stdout and an absorbed `PlatformError`'s message. Two classifications are structural, not
textual, and matter more than the pattern list: a missing executable (`kind: "spawn"` with
`.notFound`) is **never** transient — retrying cannot install a tool — and a timeout is **not**
transient by default, or a command that hangs deterministically burns its whole ceiling on every
attempt. `Retry.transient(options?)` returns ready-made `{ while, schedule, times }` for core's
`Effect.retry` — jittered exponential backoff, three attempts by default. This is **vocabulary
only**: a caller needing to repair state between attempts (reset a working tree, say) composes
`Effect.retryOrElse` or `Effect.tapError` itself.

## Point elsewhere, don't restate

- **`effect-v4-module-index`** — what `effect/unstable/process` declares (`ChildProcess` /
  `ChildProcessSpawner`), and the routing-by-task row for "spawn a subprocess".
- **`effect-v4-idioms`**, **`effect-v4-services-layers`** — general v4 generator, error-handling
  and service/layer rules; nothing here repeats them.
- **`effect-v4-testing`** — stub the spawner (`ChildProcessSpawner.make(mockSpawn)`), not `Run` —
  `Run` is free functions, so there is nothing service-shaped to mock.
- **`effected-packages`** — the full `@effected/commands` package profile and where it sits among
  the kit's 25 packages.
- **`actions-cache-and-artifacts`**, **`actions-state-and-secrets`**, **`release-and-publish`**,
  **`testing-actions`** — being authored in parallel; they cover what `@effected/github-actions`,
  `@effected/npm` and test doubles built on top of this package do that this package deliberately
  does not.
