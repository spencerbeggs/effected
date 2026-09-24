---
type: Module
title: "@effected/commands"
description: The kit's tool-and-output layer over core's subprocess contract — structured running and CLI tool discovery.
status: stable
kind: package
resource: ../../packages/commands
tags: [bundle, dx]
sources:
  - id: scripted-spawner
    resource: ../../packages/commands/src/ScriptedSpawner.ts
  - id: scripted-spawner-test
    resource: ../../packages/commands/__test__/ScriptedSpawner.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T05:32:50Z
  body_sha256: 115c101e6b43c173a266601fff90ecadde89e867c4e4d5db0d00ea015f90e083
---

# @effected/commands

`@effected/commands` is the kit's tool-and-output layer over core's
subprocess contract. It owns two concerns every consumer repository had
re-invented:

- **Structured running** (`Run`) — take a core `ChildProcess.Command`, run
  it to completion, and get a typed result: collected stdout/stderr/exit
  code, trimmed text, lines, schema-decoded JSON, a boolean probe, or a
  stream — with a non-zero exit as a typed error where that is the right
  reading, an optional timeout, an optional live tee, and secrets redacted
  out of both the error and the captured output.
- **Tool discovery** (`ToolDiscovery`) — is this tool available here,
  globally on `PATH` or project-locally through the package manager's
  exec, what version is each, and which copy should run?

The two are one package because `ToolDiscovery` is `Run`'s first consumer:
discovery is a spawn plus a classification, and splitting them would put a
probe on one side of a package boundary and the runner it probes with on
the other. `Redaction` and `Retry` are policies `Run` applies or hands to a
caller, and `LocalExec` is the seam discovery resolves through — every
module in the package is on the same dependency chain.

The package is designed against core's `effect/unstable/process`
vocabulary, never around it: a caller builds a `ChildProcess.Command` with
core's own constructors and combinators and hands it here to be run.

## The one rule

**Every subprocess concept in this package is core's, and no
implementation of one is.** The only new vocabulary is the *outcome*
(collected output, typed failure), the *policy* (timeout, redaction,
transience), and the *tool* (discovery, version, source).

This rule is stated sharply because it has two failure modes and the
second is subtle. Inventing a parallel `Command` / `CommandRunner` /
`CommandSpawnError` vocabulary is the obvious one; implementing core's
contract — porting a platform spawner backend in here — is the one that
still looks correct, because a package can speak core's types faithfully
and be wrong by supplying them. Concretely, never add: a `Command` type, a
service wrapping `ChildProcessSpawner`, a spawner backend, a platform
layer, a `node:child_process` import, or a shell helper. `Run` is free
functions, not a service, for exactly this reason — core's spawner *is*
the runner service.

A previous `@effected/commands` was deleted for violating this rule twice:
first by inventing `Command`/`CommandRunner`/`CommandSpawnError`, then by
deleting that and porting `@effect/platform-node-shared`'s spawner
directly into the package. The second attempt is the subtle one, and the
reason the rule is phrased to cover implementation as well as invention.

## Tier and dependencies

**Boundary tier**, and it stays there only because the workspaces edge
inverts — see
[contract inversion is the default answer to a tier-dragging edge](../decisions/contract-inversion-default.md)
and [the commands-specific rationale](../decisions/commands-workspaces-edge-inverts.md).

- `effect` is the only peer. Zero runtime dependencies, zero
  `@effected/*` edges, zero `node:` imports anywhere in `src/`.
- IO arrives through `R`: core's `ChildProcessSpawner` for every run,
  core's `Stdio` for the teeing variant only.
- `@effect/platform-node` is a devDependency for the e2e suite only —
  never a dependency or peer.

## The workspaces edge inverts

`ToolDiscovery`'s local resolution needs to know how to run a
project-local binary (`pnpm exec`, `npx --no --`, `yarn exec`, `bun x
--no-install`), which means knowing the workspace root and the package
manager — both `@effected/workspaces`' knowledge, and `workspaces` is
integrated tier. Taking that edge directly would drag this package to
integrated, and through the `@effected/npm` → `commands` edge would drag
`npm`, `lockfiles` (pure) and `package-json` up a tier with it — four
packages, including a pure one.

So the contract inverts: `commands` declares `LocalExec` in
`packages/commands/src/LocalExec.ts` and requires it in `R`;
`@effected/workspaces` ships the layer that implements it. The contract is
deliberately smaller than "the workspaces surface" — it is an argv prefix
and a directory (`ExecContext`), not a workspace model.

- **`commands` never touches a path or an ambient `cwd`.** The whole
  question moves behind the contract.
- **The prefix table lives here, once.** `LocalExec.prefixes(launcher)` is
  the single home of the four package managers' argv — `exec`, `dlx` and
  script-runner prefixes. `scriptPrefix` is a required `ExecContext`
  field: an optional one would hand every implementation the question
  "what does absent mean?", which an execution context has no honest
  answer to. npm's script prefix carries a trailing `--`
  (`["npm", "run", "--"]`), live-probed: bare `npm run <script> --flag`
  silently claims the flag for npm itself, while the other three managers
  forward post-script arguments without help — see
  [npm run eats a flag meant for the script](../gotchas/npm-run-eats-flags.md).
- **A consumer with no monorepo pays nothing.** A single-package checkout
  wires `LocalExec.layerNone` or `LocalExec.layerFor("npm")` and never
  installs `@effected/workspaces`.

The graph stays acyclic by construction: `workspaces` takes the edge on
`commands`, and `commands` has no `@effected/*` edges at all.

## Module map

Module-per-concept, no barrels; `src/index.ts` re-exports only. See
`packages/commands/src/`:

| Module | Owns |
| --- | --- |
| `Run.ts` | the structured run combinators, `CommandOutput`, `CommandFailedError`, `CommandOutputError` |
| `Redaction.ts` | value-based secret scrubbing plus the secret-flag heuristic backstop |
| `Retry.ts` | transience classification and the retry policy — vocabulary for `Effect.retry`, not a retrying runner |
| `LocalExec.ts` | the inverted contract: `LocalExec`, `ExecContext`, `LocalExecError`, the prefix table, the layers |
| `Tool.ts` | `Tool`, the `VersionProbe` union, the `ToolSource` / `MismatchPolicy` literals |
| `ToolDiscovery.ts` | the service and its layer, `ResolvedTool`, the tool errors, the evidence cache |
| `ScriptedSpawner.ts` | the public scripted `ChildProcessSpawner` double |
| `internal/capture.ts` | bounded stream capture; not exported |

`Run`, `Redaction` and `Retry` are static classes with a private
constructor, not `as const` namespace objects: an object literal's member
types are inferred in the built `.d.ts` and lose their TSDoc entirely,
while a class's `static readonly` declarations keep it.

## What `Run` decides

- **`RunOptions` carries only what a core `Command` cannot.** `cwd`,
  `env`, `extendEnv`, `stdin`, `shell`, kill signals and fd wiring are all
  `ChildProcess.CommandOptions` fields with core combinators; duplicating
  them here is exactly the re-declaration the one rule forbids. What is
  left is genuinely ours: a deadline (no default — an install and a
  `rev-parse` cannot share one), a redaction set, and a capture bound.
- **`Run.extendEnv` exists because core's `setEnv` is a trap.** `setEnv`
  merges into `options.env` but never sets `extendEnv`, and the Node
  spawner resolves the child environment as `extendEnv ? { ...process.env,
  ...env } : env` — so a command built with a bare `setEnv({ VAR: x })`
  spawns a child whose entire environment is that one variable: no
  `PATH`, no `HOME`, silent at the type level. `Run.extendEnv` merges like
  `setEnv` and forces `extendEnv: true` even over a construction-time
  `false`, because inheriting the parent environment is its whole
  purpose; a hermetic environment is what bare `setEnv` remains for. A
  unit control pins core's own `setEnv` behaviour so a beta that changes
  it fails loudly.
- **A non-zero exit is a result for `collect`, `exitCode`, `succeeds` and
  `jsonLine`, and a typed failure for `text`, `lines` and `json`.** The
  split is deliberate. The interpreting helpers also trim — `Run.text`
  trims the whole result, which silently corrupts fixed-column output
  whose first column can be whitespace (`git status --porcelain` is the
  canonical case) — see
  [`Run.text`'s trim silently corrupts fixed-column output](../gotchas/run-text-trims-fixed-columns.md).
  Parse that from `collect`'s untrimmed `stdout` instead.
- **Collection is concurrent, and that is load-bearing.** `collect` reads
  stdout, stderr and the exit code under `{ concurrency: "unbounded" }`:
  sequential collection deadlocks the moment either OS pipe buffer fills,
  because the child blocks writing to a full pipe while the reader that
  would drain it waits on the other stream. A mock spawner over
  in-memory streams cannot reproduce it, and pressure on one stream
  alone does not discriminate, which is why the e2e backpressure test in
  `packages/commands/__test__/e2e/Run.e2e.test.ts` is not optional — see
  [`Run.collect` drains both pipes concurrently](../invariants/collect-drains-both-pipes-concurrently.md).
- **Teeing is a separate combinator, not an option.** Only `collectTee`
  requires core `Stdio` in `R`, and an option cannot vary the `R`
  channel — a boolean would tax every plain `collect` caller with a
  requirement it never uses.
- **Capture is bounded.** Unbounded collection of a child's output is a
  memory-exhaustion vector, so an overflow fails typed as
  `CommandOutputError` rather than dying. Genuinely large output is
  `Run.stream`'s job.
- **`Run.collect` is the kit's one spawn-and-collect implementation, and
  it is public on purpose.** A consumer needing `@effected/git`-shaped
  discipline for a command `Git` does not model composes `Run.collect`
  rather than re-deriving the triple-collect; `@effected/git`'s own
  private internal runner is deliberately parallel, not a second
  sanctioned copy.

### `Run.jsonLine` is framing, not a lenient `Run.json`

`json` parses the whole of stdout and requires a zero exit, which is right
for a child that prints a document and wrong for a child that talks a
protocol. `jsonLine` scans stdout lines from the end and takes the first
that both parses and decodes under the schema, so a child's own logging is
tolerated on both sides of the payload — including a line written from an
exit hook after the payload flushed.

If multiple lines decode, the last wins, so a child must not emit two
schema-valid lines and a consumer's envelope should be discriminated (a
required `ok` literal). It parses regardless of the exit code, because a
protocol payload discriminates success in-band and therefore outranks the
code. When nothing decodes anywhere, the typed `CommandOutputError` carries
the run's context — exit code and both redacted streams — with `kind:
"schema"` plus the last parseable line's decode failure when at least one
line was JSON, and `"notJson"` only when none was.
`@effected/workspaces`' `ConfigDependencyHooks.layerSubprocess` is the
in-kit consumer; do not hand-roll last-line parsing at a call site.

### `Run.detach` encodes an ordering invariant

Core can already spawn a child that outlives its parent.
`CommandOptions.detached` defaults to `true` off Windows, and the Node
backend's `acquireRelease` release checks an `isReferenced` flag and skips
the kill for an unref'd child. So `detach` is spawn → `unref` → pid, and
the ordering *is* the point: reversed, the child dies with the scope. An
e2e pair pins it both ways, because the survival half alone would pass
even if scope close never killed anything.

Two halves of a detached child's lifecycle are deliberately not here:
signalling a bare pid later (no handle survives an Actions `main` → `post`
boundary, and it needs `node:process.kill`, which a boundary package may
not import) and routing a detached child's output to a log file (core's
`CommandOptions` accepts only `"pipe" | "inherit" | "ignore" |
"overlapped" | Sink`, and the Node backend maps a `Sink` to `"pipe"`,
defeating detachment — a recorded upstream gap). Both belong to
`@effected/github-actions`, which is licensed for `node:` imports.

## Errors

Two, both structurally routable — see `packages/commands/src/Run.ts`.
`CommandFailedError` carries `kind: "nonZero" | "spawn" | "timeout"` plus
the command and its redacted argv, with ergonomic statics filling the rest
from the `Command` value the caller already has. `CommandOutputError`
carries `kind: "notJson" | "schema" | "tooLarge"`, and the combinators that
parse independently of the exit code also populate the run's exit code and
both streams, stored redacted, so a bad payload is diagnosable without
re-running the child.

There is no `reason: string` — a prose field invites consumers to match
substrings on it, so `kind` plus structured fields carry the routing and
`message` stays a rendering, never a routing surface. `message` is
tail-truncated, because npm writes warnings first and the real error last.
`stdout` is carried alongside `stderr`, for the same reason: npm routes
real errors to stdout often enough that dropping it hid causes.

An opted-in timeout is absorbed into `CommandFailedError { kind: "timeout"
}` rather than surfacing core's `Cause.TimeoutError`, the same absorption
`@effected/git` performs so consumers only ever see one taxonomy.

## Redaction and retry

`Redaction` is value-based first: the caller already holds its secrets as
`Redacted`, passes them in `RunOptions.redact`, and `Run` scrubs them from
argv and from captured stdout/stderr before either reaches an error. The
flag heuristic (`--token <v>` and friends) stays on by default as a
backstop for secrets a caller forgot to declare — it is guesswork on its
own, since it protects `--token <v>` and misses `--registry-key=<v>`.

`Retry` is vocabulary, not a retrying runner: core's `Effect.retry` already
takes `{ while, schedule, times }`, and what was missing was the
classifier. `isTransient` and the exported pattern list let a consumer
extend rather than fork, and `Retry.transient()` is a ready-made options
bag. A caller needing a reset between attempts composes that itself — a
reset is domain logic and does not belong in a retry policy.

## Tool discovery

`ToolDiscovery.resolve(tool)` answers with a `ResolvedTool` naming the
source it chose, the versions it saw, and whether they disagree; the
policy (`source`, `onMismatch`) is the caller's.

- **No shell, ever.** Probing availability by interpolating a tool name
  into `sh -c "command -v <name>"` is an injection hazard and broken on
  Windows. Absence is a spawn failure, never an exit code: the probe
  spawns the tool itself with its version flag, a `PlatformError` whose
  `reason._tag` is `"NotFound"` means absent, and any completed run means
  present. A tool whose `--version` exits 1 exists.
- **Option-injection guard.** A tool name that is empty or begins with
  `-` is refused before any spawn, typed as its own `ToolRefusedError` —
  not `ToolNotFoundError`, which carries a `searched` list a refusal has
  no answer for.
- **The cache holds evidence, not answers.** The cached value is the
  probe outcome, keyed by `(name, version probe)` as a `Schema.Class`
  whose structural `Equal`/`Hash` the cache uses directly, and policy is
  applied per call — caching resolved values by name alone would let a
  second `Tool` with different constraints silently inherit the first
  caller's policy decision.
- **Core `Cache`, not a bare `Ref`,** for in-flight de-duplication: two
  fibers resolving one tool concurrently produce one probe. Core `Cache`
  does not share `Effect.cached`'s interrupt-poisoning property, but it
  does memoize failures for the entry's TTL, which is why the
  `timeToLive` function is load-bearing.
- **Only a positive result is memoized forever.** "Not found" is a
  successful lookup carrying negative evidence, and memoizing it would
  make a tool installed mid-process — an action that provisions a runtime
  and then uses it — permanently absent.

## Test doubles

`ToolDiscovery.makeTest` / `layerTest` follow the kit convention: every
unstubbed member dies naming itself, because a fabricated `ResolvedTool`
would leak into consumer logic as fact. `LocalExec.makeTest` deliberately
does not, and that is a recorded exception: its one member has a correct
real answer for the unstubbed case (`Option.none()` *is* the global-only
wiring, not a fabrication). The test for whether a default is admissible is
"would a real implementation legitimately answer this?", never "is it
convenient".

`ScriptedSpawner` is a public scripted double of core's
`ChildProcessSpawner` — `make(script)` returns a layer plus the spawn log,
with statics building the two common spawn-failure `PlatformError`s. It is
not an exception to the one rule: it implements nothing for production, it
*provides* core's own contract from a caller's script, the test-side
analogue of `makeTest` on a service. The spawn log records whether `unref`
actually ran, which is what lets a consumer test pin `Run.detach`'s
ordering. Every recorder is `Effect.suspend` / `Effect.sync`-wrapped, so
a spawn is logged when the effect *runs*, never when it is merely
constructed — an eager recorder would report calls that never happened,
and the double's own suite pins the distinction along with the `unref`
flag.[^scripted-spawner][^scripted-spawner-test] Standard commands only —
a piped command reaching it dies loudly naming the workaround, because
scripting a pipeline honestly means modeling core's `PipeOptions` routing
and dying beats a silently wrong answer.

## What this package deliberately does not do

- **No `Command` type and no runner service.** Core declares both;
  `ResolvedTool.command(...)` returns a core `Command` and `Run` is free
  functions over it.
- **No spawner backend, no platform layer, no shell helper.** A
  misbehaving backend is fixed upstream, not shimmed here; a consumer
  running a configured command string builds `ChildProcess.make("sh",
  ["-c", str])` itself and owns the injection surface.
- **No package-manager detection, no PATH or `which` implementation.**
  The first is inverted to `LocalExec`; the second is unnecessary, because
  probing by spawn answers the only question asked without a filesystem
  scan, `PATHEXT` handling or a `FileSystem` requirement.
- **No process supervision, no readiness polling.** `detach` hands back a
  pid and stops. The reap half and the poll-until-predicate helper are
  `@effected/github-actions`'.
- **No archive helper.** An honest archive API is not a `tar` wrapper — it
  has to answer determinism (mtimes, uid/gid, entry order), `bsdtar`
  -versus-GNU flag divergence and whether extraction is in scope — so
  shipping one here would sink that design into the wrong package.
- **No ambient `cwd`, no `process.env` reads, no `node:` imports.**
- **Version constraints on a `Tool` stay deferred.** The hazard is
  asymmetric: refusing a tool that works because `tar (GNU tar) 1.35` is
  not a bare semver is worse than not checking at all.

See also
[the workspaces edge inverts rather than dragging four packages integrated](../decisions/commands-workspaces-edge-inverts.md)
and
[the limitations this package deliberately does not lift](../limitations/commands-no-process-supervision.md).

## Observability

Named `Effect.fn` spans on every public fallible boundary, stable
identifiers only in annotations — the executable name, argc, the resulting
exit code, the tool name and resolved source — and never argv values and
never captured output, since argv is where secrets appear. No metrics: a
library should not decide cardinality for the consumer paying the bill. No
logging inside the combinators.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in
`__test__/`, e2e under `__test__/e2e/`.

- Unit suites stub core's spawner with the public `ScriptedSpawner`, which
  is why the double is itself directly tested: it is load-bearing
  machinery for every suite here and downstream. The spawn log is what
  makes "cached", "concurrent resolves share one probe" and "the guard
  refuses before any spawn" real assertions about probe counts rather
  than plausible ones.
- Redaction gets a property test, not examples: no rendered message, no
  `args` array and no captured stream ever contains a secret's value.
- e2e runs real processes through `@effect/platform-node`: the ENOENT →
  `NotFound` mapping the whole absence classification rests on, the
  dual-stream backpressure deadlock, and `detach` surviving its scope both
  ways.
- Run vitest from the repo root. From inside the package vitest does not load
  the root config, so a project-filtered run fails at startup with
  `No projects matched the filter` (exit 1).

Build through `pnpm build --filter @effected/commands`, never the raw
script. `savvy.build.ts` carries the narrow `_base` suppression for the
synthesized class-factory bases; never widen it. A genuine
`ae-unresolved-link` warning is fixed, not suppressed: a schema-declared
field and a shape-interface member are not `{@link}` targets, so spell them
in backticks.

## Consumers

- **`@effected/workspaces`** — implements `LocalExec` and takes the only
  inbound edge; also a `Run` caller, since
  `ConfigDependencyHooks.layerSubprocess` runs its replay child through
  `Run.jsonLine`.
- **`@effected/npm`** — `PackagePublish` runs `npm publish` through `Run`,
  with the publish token in `RunOptions.redact`.
- **`@effected/github-actions`** — the general-purpose runner behind
  action work, plus the owner of the two lifecycle halves this package
  declines.

[^scripted-spawner]: `packages/commands/src/ScriptedSpawner.ts` — the
    module comment on lazy recorders, and the `unref: Effect.sync(...)`
    that flips the record's `unrefed` flag only when it runs.
[^scripted-spawner-test]: `packages/commands/__test__/ScriptedSpawner.test.ts`
    — "records spawns in call order, only when the effect actually runs"
    and "unrefed flips only when the handle's unref actually RUNS".
