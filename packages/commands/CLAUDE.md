# @effected/commands

Structured command running and CLI tool discovery over core's
`ChildProcessSpawner`. Two concerns designed together: **run a command and get
a typed result** (`Run`), and **find out whether a tool is here and which copy
to use** (`ToolDiscovery`). Replaces `@savvy-web/github-action-effects`'
`CommandRunner` and generalizes silk-effects' `ToolDiscovery`; Phase 1a of the
GitHub/Actions split.

**Design doc:** `@../../.claude/design/effected/packages/commands.md`

## Tier: boundary

`effect` is the only peer. **Zero runtime dependencies, zero `@effected/*`
edges, zero `node:` imports anywhere in `src/`.** IO arrives through `R`: core's
`ChildProcessSpawner` for every run, core's `Stdio` for `Run.collectTee` only.
`@effect/platform-node` is a **devDependency used only by
`__test__/e2e/`** — never a dependency or peer.

The boundary tier is **conditional on the `LocalExec` inversion** (below). A
direct `@effected/workspaces` edge would make this package integrated and, via
the planned `@effected/npm` → `commands` edge, drag `npm`, `lockfiles` (pure!)
and `package-json` up a tier with it.

## The one rule this package exists to obey

**Every subprocess concept here is core's, and no implementation of one is.**

A previous `@effected/commands` was deleted for violating this twice: it
invented `Command`/`CommandRunner`/`CommandSpawnError` (plan
`2026-07-14-commands-runner-core.md`), then deleted all that and **ported
`@effect/platform-node-shared`'s spawner into the package** (plan
`2026-07-14-commands-spawner-pivot.md`). The second one is the subtle one:
importing core's vocabulary faithfully is necessary but **not sufficient** — a
package can speak core's types and still be wrong by implementing them.

Concretely, never add: a `Command` type, a service wrapping `ChildProcessSpawner`,
a spawner backend, a platform layer, a `node:child_process` import, or a shell
helper. `Run` is **free functions**, not a service, for exactly this reason.

## Five source modules

- `Redaction.ts` — `apply` / `applyArgs` (by **value**, from `Redacted`) and
  `scrubArgs` (flag heuristic). Value-based is primary; the heuristic is a
  backstop for secrets a caller forgot to declare.
- `Retry.ts` — `isTransient` / `transient()` / `TRANSIENT_PATTERNS`. Vocabulary
  for `Effect.retry({ while, schedule, times })`, **not** a retrying runner.
- `Run.ts` — `collect` / `collectTee` / `text` / `lines` / `json` / `exitCode` /
  `succeeds` / `stream` / `detach` / `extendEnv`, `CommandOutput`,
  `CommandFailedError`, `CommandOutputError`.
- `Tool.ts` — `Tool`, the `VersionProbe` union (`VersionFlag` / `VersionJson` /
  `VersionNone`), `ToolSource`, `MismatchPolicy`.
- `ToolDiscovery.ts` — the service + layer, `ResolvedTool`, the three tool
  errors, the evidence cache.
- `internal/capture.ts` — bounded stream capture. Not exported.

`Run`, `Redaction` and `Retry` are static classes with a private constructor,
not `as const` namespace objects — an `as const` object's member types are
inferred in the built `.d.ts` and lose their TSDoc entirely, while a class's
`static readonly` declarations keep it. Call syntax is unaffected
(`Run.collect(...)`); each internal implementation stays a plain function or
const, carrying only a one-line pointer comment, with the full contract TSDoc
living on the static.

## The things that will bite you

### `{ concurrency: "unbounded" }` in `collectRaw` is load-bearing

Collecting stdout, stderr and the exit code **sequentially deadlocks** the
moment either OS pipe buffer fills: the child blocks writing to a full pipe
while the reader that would drain it is still waiting on the other stream. This
is not theory — flipping it to `{ concurrency: 1 }` makes
`__test__/e2e/Run.e2e.test.ts`'s backpressure test hang until its 30s timeout.
A mock spawner over in-memory streams **cannot** reproduce it, and pressure on
one stream does not discriminate. **Do not delete that e2e test.**

### A non-zero exit is a RESULT, not an error — for three of the combinators

`collect`, `exitCode` and `succeeds` report the exit code (core's contract:
`handle.exitCode` succeeds with any code). `text`, `lines` and `json` treat a
non-zero exit as a typed `CommandFailedError`. The split is deliberate; do not
"fix" either half.

`Run.text` also **trims** the result — leading and trailing whitespace, not
just a trailing newline. That silently corrupts fixed-column output whose
columns start with whitespace (`git status --porcelain`'s leading-space status
column). Parse that kind of output from `Run.collect`'s untrimmed
`CommandOutput.stdout`, never from `Run.text`'s return value.

### Absence is a spawn failure, never an exit code

`ToolDiscovery` decides presence by whether the process **ran**. A tool whose
`--version` exits 1 exists. This is why there is no `command -v` probe — v3
interpolated the tool name into `sh -c`, which was both an injection hazard and
broken on Windows — and why the e2e suite pins the platform backend's
ENOENT → `NotFound` mapping: the whole classification rests on it.

### The evidence cache: what is cached, and what is deliberately NOT

`ToolDiscovery` caches **probe evidence**, not resolved answers, keyed by
`(name, version probe)` as a `Schema.Class` (structural `Equal`/`Hash`, verified
at beta.101 including nested union members). Policy — `source`, `onMismatch` —
is applied per call, so a second `Tool` with different constraints gets the
right answer with no second probe. v3 keyed resolved answers by name alone and
silently handed the first caller's policy decision to the second.

**Two TTL traps, both probed 2026-07-25 and both live in one `timeToLive`:**

1. Core `Cache` memoizes a **failed** lookup for the entry's TTL. One transient
   failure would stick for the process lifetime.
2. "Not found" is a **successful** lookup carrying negative evidence. Memoized,
   a tool installed mid-process (an action that provisions a runtime and then
   uses it) stays absent forever.

So only a **positive** result gets `Duration.infinity`; everything else gets
zero. A tool that exists does not stop existing; a tool that does not exist very
often starts to.

Core `Cache` does **not** share `Effect.cached`'s interrupt-poisoning property
(probed with a control that reproduced the poisoning first) — an interrupted
lookup is discarded and re-run.

### `Run.detach` — unref BEFORE the scope closes

The Node backend tracks an `isReferenced` flag and its `acquireRelease` release
**skips the kill** for an unref'd child. So `detach` is spawn → `unref` → pid,
and the ordering is the entire point. Reversed, the child dies with the scope.
`__test__/e2e/Run.e2e.test.ts` pins this **both ways** — unref'd survives, plain
scoped spawn is killed — because the survival half alone would pass even if
scope close never killed anything.

**Not in this package:** signalling a bare pid later (no handle across an
Actions main→post boundary; needs `node:process.kill`) and readiness polling.
Both belong to `@effected/github-actions`. Routing a detached child's output to
a log file is an **upstream gap** — core's `CommandOptions` accepts only
`"pipe" | "inherit" | "ignore" | "overlapped" | Sink`, and the Node backend maps
a `Sink` to `"pipe"`, which defeats detachment.

### `RunOptions` carries only what a core `Command` cannot

`cwd`, `env`, `extendEnv`, `stdin`, `shell` and kill signals are
`ChildProcess.CommandOptions` fields with core combinators (`setCwd`, `setEnv`).
Duplicating them here is the re-declaration that killed the previous package.
What is left: `timeout` (**no default** — an install and a `rev-parse` cannot
share one), `redact`, `maxOutputBytes`.

**The `extendEnv` trap.** Core's `setEnv` merges into `options.env` but never
sets `extendEnv`, and the Node spawner resolves the child environment as
`extendEnv ? { ...process.env, ...env } : env` — so a command built with bare
`setEnv({ SOME_VAR: x })` spawns a child whose ENTIRE environment is that one
variable: no `PATH`, no `HOME`, silent at the type level, "tool cannot find its
own binary" at runtime. **`Run.extendEnv` is the blessed path for "add env vars
without losing the parent environment"**: it merges like `setEnv` (new values
win) AND forces `extendEnv: true` — deliberately, even over a construction-time
`false`, because inheriting the parent env is its whole purpose. It composes
public `ChildProcess.make`/`pipeTo` (no re-declaration). A hermetic env is what
bare `setEnv`/construction options are for. The unit suite carries a CONTROL
pinning the core behavior itself — if it fails, a core beta changed `setEnv`
and the combinator's raison d'être needs re-evaluating.

### The test doubles do NOT default the same way, on purpose

`ToolDiscovery.makeTest` follows the kit convention: every unstubbed member
**dies** naming itself, because none of them has an honest default — a
fabricated `ResolvedTool` would leak into consumer logic as fact.

`LocalExec.makeTest` deliberately does **not**. Its one member has a correct,
real answer for the unstubbed case: `Option.none()` *is* the global-only wiring,
not a fabrication. Dying there would force every consumer test to stub a member
it does not care about, to assert something the double already knows. Recorded
as an accepted exception to the die-loudly rule (2026-07-25) — the test for
whether a default is admissible is "would a real implementation legitimately
answer this?", not "is it convenient".

### Biome edges in this package

Two rules false-positive on Effect idioms here. Both fixes are narrow; neither
disables a rule globally.

- **`Sink.forEach` trips `lint/suspicious/useIterableCallbackReturn`.** Biome
  pattern-matches the *name* against `Array#forEach` and demands the callback
  return nothing, but a `Sink` callback returns an `Effect`. Fix: a
  `biome-ignore` line directly above the call with the reason spelled out (see
  `__test__/Run.test.ts`). Do not restructure the sink to satisfy it.
- **An exhaustive `switch` inside a getter trips `lint/suspicious/useGetterReturn`.**
  Biome cannot prove a `switch` over a literal union is exhaustive, so it sees a
  path with no return. Fix: an if-chain with the final variant as the tail
  return — the shape `CommandOutputError.message` now uses. Prefer that for any
  literal-union message getter.

Two more worth knowing, both hit while writing this package: `useImportType`
fires on a symbol used **only** in a type position (`LocalExecError` appears
solely in the `ToolResolutionFailure` union), and the Biome LSP only sees files
you have touched — run `biome_check` over the whole package before handing work
off, or a formatting-only diff bounces the pre-commit hook.

### `collectTee` is a separate combinator, not an option

Only it requires core `Stdio` in `R`, and **an option cannot vary the `R`
channel** — a boolean would tax every plain `collect` caller with a `Stdio`
requirement.

## Testing

118 tests in `__test__/`: 108 unit (Redaction 17, Run 36, Retry 12, LocalExec
10, ToolDiscovery 33) and 10 e2e. `@effect/vitest`, `it.effect`, `assert.*` —
never `expect`.

- Unit: `__test__/fixtures.ts` scripts a `ChildProcessSpawner` via
  `ChildProcessSpawner.make(mockSpawn)` + `makeHandle` over in-memory streams,
  and **records spawns** (including whether `unref` actually ran). Every
  recorder is `Effect.sync`/`suspend`-wrapped so it fires when the effect runs,
  not when it is built.
- The spawn log is how the cache tests assert *probe counts* — that is what
  makes "cached", "concurrent resolves share one probe" and "the guard refuses
  before any spawn" real assertions rather than plausible ones.
- e2e: real `node` through `NodeServices.layer`. **Run vitest from the repo
  root** — a project-filtered run from inside the package prints
  `Tests: 0/0 passed` and exits 0.

```bash
pnpm vitest run packages/commands/__test__     # from the repo root, always
pnpm build --filter @effected/commands          # never `node savvy.build.ts` directly
```

`savvy.build.ts` carries the narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the 15
synthesized class-factory bases. Never widen it: the two genuine
`ae-unresolved-link` warnings this package hit were **fixed** (schema-declared
fields and shape-interface members cannot be `{@link}` targets — use backticks),
not suppressed. Current prod `issues.json`: 0 warnings, 0 errors, 15 suppressed.
