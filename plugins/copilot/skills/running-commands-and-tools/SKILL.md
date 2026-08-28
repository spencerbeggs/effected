---
name: running-commands-and-tools
description: >-
  Use when running a subprocess in Effect v4, spawning a command, capturing stdout/stderr/exit
  code, checking whether a CLI tool is installed or which copy to run, running a package-manager
  script through the project's launcher, detaching a background process, or redacting a secret
  from argv or captured output.
---

# Running commands and finding tools

`@effected/commands` is the kit's tool-and-output layer over core's
subprocess contract: `Run` turns a core `ChildProcess.Command` into typed
structured output; `ToolDiscovery` answers "is this tool here, and which
copy should I run?" Both are boundary tier — `effect` is the only peer,
zero `@effected/*` edges, zero `node:` imports.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `Run.collect`, `.collectTee`, `.text`, `.lines`, `.json`, `.exitCode`, `.succeeds`, `.stream`, `.detach` | `import { Run } from "@effected/commands"` | Running a core `ChildProcess.Command` and capturing typed output |
| `Run.jsonLine` | `@effected/commands` | Framing ONE schema-decoded JSON payload line out of a child's otherwise noisy stdout (a subprocess protocol envelope) |
| `ToolDiscovery`, `Tool.named` | `@effected/commands` | Checking whether a CLI tool is installed, and which copy (local vs global) to run |
| `LocalExec`, `ExecContext` | `@effected/commands` | Prefixing a command through the project's local launcher (`npx`/`pnpm exec`/`yarn exec`/`bun x`) |
| `Redaction` | `@effected/commands` | Scrubbing a secret from argv or captured stdout/stderr |
| `Retry` | `@effected/commands` | Classifying a `CommandFailedError` as transient and retrying it |
| `ScriptedSpawner` | `@effected/commands` | A shipped scripted `ChildProcessSpawner` double for tests |
| `CommandFailedError`, `CommandOutputError` | `@effected/commands` | Handling "couldn't run/ran and failed" vs "ran, but output is unusable" |

## Standards

- **Every subprocess concept here is core's, and no implementation of one
  is.** Never add a `Command` type, a service wrapping
  `ChildProcessSpawner`, a spawner backend, a `node:child_process` import,
  or a shell helper that interpolates a tool name — core's
  `effect/unstable/process` already declares the vocabulary, and `Run` is
  free functions for exactly this reason: core's spawner already *is* the
  runner service.
- **A non-zero exit is a result for `collect`/`exitCode`/`succeeds`/
  `jsonLine`, a typed error for `text`/`lines`/`json`.** The split mirrors
  core's own contract and is deliberate — do not "fix" either half to
  match the other.
- **A JSON protocol payload from a child goes through `Run.jsonLine`, never
  a hand-rolled last-line parse.** It scans stdout lines from the **end**
  and takes the first that both JSON-parses and schema-decodes, so a
  child's own `console.log` noise is tolerated on *both* sides of the
  payload. Two consequences to design for: if several lines decode, the
  **last** wins, so give the envelope a required discriminant (an `ok`
  literal) that an accidental log line cannot satisfy; and it parses
  **regardless of the exit code**, because an in-band `ok` field outranks
  the code — a child that crashed after flushing still reported. Whole-
  stdout JSON with exit-code semantics is `Run.json`; the two are not
  interchangeable.
- **Add env vars on top of the parent environment through
  `Run.extendEnv`, never a bare `setEnv`.** A bare `setEnv` replaces the
  child's whole environment (no `PATH`, no `HOME`) unless `extendEnv` is
  explicitly set.
- **When you need both output and exit code, use `Run.collect` or read both
  off the same spawner handle.** Composing two convenience members
  re-executes the command — idempotent commands hide it, anything else
  fails on the second run while the captured "failure" belongs to the
  first, successful one.
- **Decide tool presence by whether the process ran, never by exit code or
  a `command -v` probe.** A tool whose version flag exits 1 still exists;
  a `command -v`-shaped probe is an injection hazard and breaks on
  Windows.
- **`commands` declares `LocalExec`; `@effected/workspaces` implements
  it.** Never add a direct `@effected/workspaces` edge to this package — a
  single-package consumer wires `LocalExec.layerFor("npm")` or
  `.layerNone` instead of pulling in workspace discovery at all.
- **Redact by value first, then apply the flag-name backstop.** Value-based
  redaction catches a secret wherever it appears, including embedded in a
  larger string; the heuristic backstop only covers what a caller forgot
  to declare — always run both, never one instead of the other.
- **`Option.none()` is a real `LocalExec` answer, not an error.** "No
  project-local way to run tools here" is a legitimate global-only
  context, not a fabrication or a failure to raise.

## Footguns

- Collecting stdout/stderr/exit code sequentially **deadlocks** the moment
  either OS pipe buffer fills — this is why the internal collection uses
  unbounded concurrency; a mocked spawner over in-memory streams cannot
  reproduce this class of bug, so the real dual-stream backpressure test
  must never be deleted. See
  [`references/run-combinators.md`](references/run-combinators.md).
- `Run.detach` must unref **before** its scope closes — reversed, the
  scoped release kills the child anyway, defeating detachment entirely.
- `Run.text` trims leading and trailing whitespace, which silently corrupts
  any column-oriented output whose columns start with whitespace (a status
  column, say). Route that output through `Run.collect` and parse the raw
  stdout instead.
- The tool-discovery evidence cache must give a failed or not-found probe a
  short TTL and a found probe an infinite one — the opposite of a plain
  cache's default failure-memoization, or a transient probe failure sticks
  for the process lifetime and a tool installed mid-process stays absent
  forever.

## Additional resources

- [references/run-combinators.md](references/run-combinators.md) — the
  full `Run` combinator table, `RunOptions`, and all seven subprocess traps
  (deadlocking collection, `collectTee`'s `R` split, detach/unref ordering,
  env-extension, text-trim corruption, double-execution) with the error
  taxonomy. Load when: choosing a combinator, tuning `RunOptions`, or
  classifying a command failure.
- [references/tool-discovery.md](references/tool-discovery.md) —
  `ToolDiscovery`'s presence semantics, `VersionProbe` variants, the
  evidence-cache TTL rules, and `LocalExec`'s full contract-inversion story
  including the four package managers' argv prefixes. Load when: resolving
  tool presence/version, or wiring a project-local launcher.
- [references/subprocess-traps.md](references/subprocess-traps.md) —
  `Redaction`'s value-based and heuristic layers, `Retry`'s transient
  classification, and the shipped `ScriptedSpawner` test double. Load
  when: redacting a secret, retrying a transient command failure, or
  scripting a fake spawner for a test.

## Point elsewhere, don't restate

- `effect-v4-module-index` — what `effect/unstable/process` declares
  (`ChildProcess`/`ChildProcessSpawner`), and the routing-by-task row for
  "spawn a subprocess".
- `effect-v4-idioms`, `effect-v4-services-layers` — general v4 generator,
  error-handling and service/layer rules; nothing here repeats them.
- `effect-v4-testing` — stub the spawner, not `Run` — `Run` is free
  functions, so there is nothing service-shaped to mock.
- `effected-packages` — the full `@effected/commands` package profile.
- `actions-cache-and-artifacts`, `actions-state-and-secrets`,
  `release-and-publish`, `testing-actions` — what
  `@effected/github-actions`, `@effected/npm` and test doubles built on top
  of this package do that this package deliberately does not.
