# `Run` combinators, options and errors

Load when: choosing a `Run` combinator for a specific shape of subprocess
output, tuning `RunOptions`, or classifying a `CommandFailedError`/
`CommandOutputError`.

## The combinator table

All ten combinators take a core `ChildProcess.Command` plus optional
`RunOptions`, and require `ChildProcessSpawner` in `R` (`collectTee`
additionally requires `Stdio`):

| Combinator | Answers | Non-zero exit |
| --- | --- | --- |
| `Run.collect` | a `CommandOutput` — stdout, stderr, exit code | a **result**, not an error |
| `Run.collectTee` | as `collect`, teeing both streams to `Stdio` live | a **result** |
| `Run.text` | trimmed stdout | typed `CommandFailedError` |
| `Run.lines` | trimmed, non-empty stdout lines | typed `CommandFailedError` |
| `Run.json` | stdout parsed as JSON and schema-decoded | typed `CommandFailedError` |
| `Run.jsonLine` | the LAST stdout line that both JSON-parses and schema-decodes | a **result** — it decodes regardless of the exit code |
| `Run.exitCode` | just the exit code | a **result** |
| `Run.succeeds` | did it run and exit zero? | never fails — answers `false` |
| `Run.stream` | decoded stdout lines as they arrive | typed failure on the stream |
| `Run.detach` | spawn, unref, return the pid | typed failure only if it never started |

If a consumer still writes `JSON.parse(output.stdout) as X`, reach for
`Run.json` instead — it decodes through a `Schema.Codec` and distinguishes
a `"notJson"` failure from a `"schema"` failure rather than collapsing both
into one `reason` string.

## Trap 1 — a non-zero exit is a RESULT, not an error, for exactly four combinators

`collect`, `exitCode`, `succeeds` and `jsonLine` report the exit code — this
is core's own contract: the spawner's exit-code member succeeds with any code.
`text`, `lines` and `json` treat a non-zero exit as a typed
`CommandFailedError` (`kind: "nonZero"`) instead. The split is deliberate — do
not "fix" either half to match the other.

## Trap 1b — `Run.jsonLine` is FRAMING, not a lenient `Run.json`

`jsonLine` splits stdout on `\r?\n`, drops whitespace-only lines, scans **from
the end**, and takes the first line that both JSON-parses and decodes under the
schema. That tolerates a child's own logging on **both** sides of the payload —
a banner before it and an exit-hook line after it. Three consequences:

- **If several lines decode, the last one wins.** A child must not emit two
  schema-valid lines, and a protocol envelope should be discriminated (a
  required `ok` literal) so an accidental log line cannot satisfy it.
- **It parses regardless of the exit code**, because a protocol payload
  discriminates success in-band and outranks the code: a child that crashed
  *after* flushing its result still reported. Want exit-code semantics over
  whole-stdout JSON? That is `Run.json`; the two are not interchangeable.
- **Nothing decoding anywhere is a typed `CommandOutputError`** carrying the
  exit code and both redacted streams — `kind: "schema"` with the last
  JSON-parseable line's decode issue as `cause` when at least one line parsed,
  `"notJson"` only when no line anywhere was JSON.

`@effected/workspaces`' `ConfigDependencyHooks.layerSubprocess` is the in-kit
consumer, and adopting `jsonLine` deleted a hand-rolled copy of this framing —
**do not re-hand-roll last-line parsing at a call site.**

## Trap 2 — collecting streams sequentially deadlocks

Reading stdout, stderr and the exit code sequentially **deadlocks** the
moment either OS pipe buffer fills: the child blocks writing to a full pipe
while the reader that would drain it is still waiting on the other stream.
`Run`'s internal collection reads all three under unbounded concurrency for
exactly this reason. A mocked spawner over in-memory streams **cannot**
reproduce this — pressure has to be on both OS pipes at once — so the
dual-stream backpressure e2e test that proves it must never be deleted, and
a unit-only suite can never stand in for it.

## Trap 3 — `collectTee` is a separate combinator, not an option

Only `collectTee` requires core `Stdio` in `R`. An option cannot vary the
`R` channel — a boolean echo flag on `collect` would tax every plain caller
with a `Stdio` requirement it never uses. `collectTee` still collects while
echoing; it is not merely a live-output variant.

## Trap 4 — `Run.detach`: unref BEFORE the scope closes

The Node backend tracks whether a spawned handle has been unref'd, and its
scoped release **skips the kill** for an unref'd child — so the ordering
inside `detach` is the entire point: unref, then let the scope close.
Reversed, the child dies with the scope. The e2e suite pins this both
ways — an unref'd child survives well past scope close, and a plain scoped
spawn with no unref is dead by the same point, so the survival assertion
alone can't pass by accident.

**Not in `Run`, with named homes elsewhere:** signalling a bare pid later —
no handle survives an Actions main→post process boundary, and the signal
call needs a process-global import a boundary package may not take; home is
`@effected/github-actions`'s `DetachedProcess`, see `actions-state-and-secrets`.
Routing a detached child's output to a log file has no home here
either — core's stdio options don't support both detachment and a sink
destination together; this is an upstream gap, not a hole to patch with a
backend in this package.

## Trap 5 — `RunOptions` carries only what a core `Command` cannot

```ts
export interface RunOptions {
  readonly timeout?: Duration.Input | undefined;   // no default
  readonly redact?: ReadonlyArray<Redacted.Redacted<string>> | undefined;
  readonly maxOutputBytes?: number | undefined;    // default Run.DEFAULT_MAX_OUTPUT_BYTES (16 MiB)
}
```

`cwd`, `env`, `extendEnv`, `stdin`, `shell` and kill signals are core
`ChildProcess.CommandOptions` fields with core combinators — build them
through the core `Command` API, never re-declare them on `RunOptions`.

One trap in that routing: a bare core `setEnv` call never sets `extendEnv`,
and the Node spawner resolves the child's environment as the merge only
when `extendEnv` is true — so setting one variable alone spawns a child
whose **entire** environment is that one variable (no `PATH`, no `HOME`).
Route "add env vars on top of the parent environment" through
`Run.extendEnv({ VAR: x })`, which merges (new values win) and forces
`extendEnv: true`, recursing into pipelines. Reserve bare `setEnv`/
construction options for a deliberately hermetic environment.

`timeout` has **no default** — an install and a quick status probe cannot
share a ceiling — and expiry folds into `CommandFailedError { kind:
"timeout" }` rather than widening every caller's error channel with a
platform timeout type.

## Trap 6 — `Run.text` trims; that silently corrupts column-oriented output

`Run.text` trims **leading and trailing** whitespace, not just a trailing
newline. That's the right shape for "the value of one line of output" and
the wrong shape for anything whose columns start with whitespace — a
leading-space status column in porcelain-style output is exactly this
shape, where the leading space *is* the status, not padding. `Run.text`
silently eats it, and a caller that substring-parses the trimmed result
reads the wrong field for every entry whose status column was a space.
Route fixed-column, whitespace-significant output through `Run.collect`
instead — its output is untrimmed — and parse the raw stdout directly
whenever column position carries meaning.

## Trap 7 — combining two spawner convenience members RE-EXECUTES the command

Core's `ChildProcessSpawner` convenience members are each derived from
their own spawn call — nothing in their signatures says so, and calling two
of them on the same command runs it **twice**. Idempotent commands hide it;
anything non-idempotent fails on the second run while the captured
output — reported as "the failure" — belongs to the first, successful
execution. When you need output AND exit code, use `Run.collect` (which
owns exactly this composition) or drop to the spawner directly and read
both from the **same** handle.

## Errors

`CommandFailedError` (`kind: "nonZero" | "spawn" | "timeout"`) is "the
command could not be run, or ran and failed"; its `.notFound` getter is the
structural "tool is not installed" signal, read by both `ToolDiscovery` and
`Retry`. `CommandOutputError` (`kind: "notJson" | "schema" | "tooLarge"`) is
"the command ran, but its output is unusable" — a genuinely separate
condition, because the process itself succeeded. It also carries **optional
`exitCode` / `stderr` / `stdout` context, already redacted**, filled in by the
combinators that parse independently of the exit code (`jsonLine`), so a bad
payload is diagnosable without re-running the command. Both carry `command`/`args`
**redacted** and a tail-truncated `message` — tools write warnings first and
the real error last, so truncating from the head, not the tail, keeps the
useful part.
