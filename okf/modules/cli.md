---
type: Module
title: "@effected/cli"
description: The boundary layer of an effect/unstable/cli program — a plain-text logger, a failure-reporting combinator, and two schema-issue renderers.
status: stable
kind: package
resource: ../../packages/cli
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: cd8183b4c0032b73f8c3d561608221caa6822e6711887145eee2e7b2c365282e
---

# @effected/cli

`@effected/cli` is the boundary layer of a command-line program built on
`effect/unstable/cli`: how output reaches a human, how a failure is
reported, and how a schema issue is rendered into a sentence a user can act
on. It is emphatically not a CLI framework — `effect/unstable/cli` owns
argument parsing, flags, the command tree and the help system, and this
package must never grow a second one.

The distinguishing property of everything in scope: a consumer only
discovers the need by shipping bad output to a person. None of it fails a
type-check, a test, or a review of the code in isolation — the default
behaviour is wrong in a way the author cannot see from the call site.

## Motivation: three defaults that are wrong at a terminal

Each of these is found by running a binary, never by reading the code.

1. **Effect's default logger is a service log line, not CLI output.** It
   emits `[00:33:56.619] INFO (#2): message` — correct for a long-running
   service being scraped, wrong for a tool a person is watching. Every
   `effect/unstable/cli` program needs a logger that renders the message
   plainly.
2. **An unhandled failure reports through the default logger, on stdout.**
   `NodeRuntime.runMain` reports an unhandled failure using Effect's
   default logger, which sits outside the layers the program was
   provided — so a program that carefully installs a CLI logger still
   prints its failures in the structured format that logger exists to
   replace, and prints them on stdout, the one stream errors must not use
   (`mytool run > log.txt` must still show failures on the terminal).
3. **A `SchemaIssue` tree is not a sentence.** A config validation failure
   arrives as a structured tree; a user needs `unknown key at
   groups.g.cleanup.rulesetz`. Core ships formatters
   (`SchemaIssue.makeFormatterStandardSchemaV1`), but they are
   near-undiscoverable — named `makeFormatter*` rather than anything
   containing "render", living in `SchemaIssue` rather than `SchemaError`
   or `Schema`, and `SchemaError.message` does not use them.

## Kit positioning

**Tier: boundary.** It performs IO — writing to a terminal is IO — but
discharges it through core contracts required in `R`, takes no external
runtime dependency, and must not import a platform package. This is the
same posture as `@effected/config-file`, and deliberately not
`@effected/github-actions`', which is the one package carrying
`@effect/platform-node` as a required peer.

**Nothing in the kit may depend on it except an application**, the same
rule `@effected/app` carries. A library that reaches for CLI output has
made a decision that belongs to the program at the top. `app` and `cli` are
siblings, not layers: `app` is the control plane (directories, state,
cache, config), `cli` is the presentation boundary. Neither imports the
other.

`@effected/cli` is one of the surfaces the consumer register describes —
see [`reposets`](../consumers/reposets.md), the first repository to weigh
a new request against it.

## Public surface

Exports are static classes with a private constructor — never an
`as const` namespace object, which loses its members' TSDoc in the built
`.d.ts`.

| Export | What it is |
| --- | --- |
| `CliLogger` | A `Logger` rendering messages plainly, routing to stderr from `stderrFrom` down and everything else to stdout |
| `CliRuntime` | The failure-reporting wrapper: report through the program's own logger, set the exit code |
| `CliRuntime.main` | The full-program combinator: provides the platform layer inside failure reporting, a fresh `CliExit`, the `ShowHelp` remap, and the logger outermost. See "Findings are success" below. |
| `CliExit` | A `Context.Service` holding a `MutableRef<number>`; `CliExit.set(code)` and `CliExit.layer` for in-process tests. See "Findings are success" below. |
| `CliColor.enabled` | `Effect<boolean, never, Stdio>` — `Stdio.stdoutIsTerminal` and a non-empty `NO_COLOR` read through `Config.option`, never `process` (D8). |
| `CliColor.formatterLayer` | `(overrides?: Partial<CliOutput.Formatter>) => Layer<never, never, Stdio>` — builds `CliOutput.defaultFormatter({ colors })` from the same `CliColor.enabled` decision, so help text, parse errors and rendered output always agree. |
| `ReportFailuresOptions.usageExitCode` | Remaps a `ShowHelp` that carries errors to this code, default 64 (D7). A `ShowHelp` with no errors keeps exit 0. |
| `SchemaIssueRenderer` | `SchemaIssue` tree → actionable lines, over core's formatter |
| `ConfigIssueRenderer` | The same for `@effected/config-file`'s `ConfigValidationError` |

### `@effected/cli/testing` (new subpath)

| Export | Contract |
| --- | --- |
| `CliTest.sandbox` | `Effect<Sandbox, PlatformError, FileSystem \| Path \| Scope>`. A temporary directory with a fresh `HOME` and `XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, and `NO_COLOR=1`. `PATH` is taken from an injected value and never inherited through `extendEnv`. |
| `CliTest.run` | `(bin, args, { sandbox, execPath, path?, cwd?, stdin? }) => Effect<{ exitCode; stdout; stderr }, PlatformError, ChildProcessSpawner \| Scope>`. A non-zero exit is data, not a failure. Spawns `execPath` with `[bin, ...args]` over core `ChildProcess` (D9), no peer on `@effected/commands`. **When `stdin` is omitted, the spawned child receives an already-ended empty input, never an open pipe** — a test that does not pass `stdin` never hangs waiting for one. |

See [D9: `CliTest` uses core `ChildProcess`](../decisions/cli-testing-uses-core-child-process.md)
for why this subpath takes no dependency on `@effected/commands`.

### CliLogger, and why it does not need `Stdio`

The obvious design — write through `Stdio`'s `stdout()` / `stderr()`
sinks — does not fit: `Logger.make(log)` takes a synchronous callback,
while a `Sink` write is an `Effect`, and a logger cannot `yield*`. The
sanctioned path is the one core's own `defaultLogger` takes: read the
`Console` reference off the fiber, synchronously, and route the write
based on the log level.

Levels are compared ordinally, never by string equality —
`LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)`, never
`logLevel === "Error" || logLevel === "Fatal"`, which hard-codes two names
and silently misses any level added upstream above `Fatal`. **`stderrFrom`
defaults to `"All"`** ([D3](../decisions/cli-logger-defaults-all-to-stderr.md)):
every log level routes to stderr unless a consumer narrows it explicitly,
so a CLI's stdout carries only what the program writes with `Console.log`
— never a diagnostic `Effect.logInfo` line a consumer never chose to print
as output. This is a breaking 0.x change; the changeset says so. Any
consumer relying on the old `"Error"`-only default now sees `Info`-level
log lines move to stderr.

`Console.Console` is a public `Context.Reference<Console>` with
`globalThis.console` as its default value, so nothing is imposed on the
consumer's layer stack, the stderr/stdout split is directly expressible as
`console.error` versus `console.log`, and the surface is testable by
construction — swapping the reference is how `TestConsole` already works.
`References.LogToStderr` is a public reference too, and `CliLogger` honours
it only as a force-all-to-stderr override, never as a per-level one — a
consumer who sets it meant "this whole program's output is diagnostic".

### CliRuntime — wrap the reporting, not the runtime

The failure in motivation 2 is *where the report happens*, not that
`runMain` exists. The fix is to catch inside the effect, render through the
program's own logger, and set the exit code — all before any `runMain` is
called. This package provides a combinator applied inside the program, and
the consumer still calls their platform's `runMain` themselves:

```ts
NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures, Effect.provide(MainLive)))
```

Wrapping `runMain` itself would drag a platform choice into a library that
has no business making one, and would make the package unusable from Bun or
Deno for no gain.

### Findings are success, exit codes still reach teardown

A handler that reports findings — validation errors, lint violations, any
result a program needs to surface with a non-zero exit but that is not
itself a crash — *succeeds*, and calls `CliExit.set(code)` to record the
code it wants. `CliExit` is a `Context.Service` holding a
`MutableRef<number>`, not a `Reference`: forgetting to provide it inside
`CliRuntime.main` is a type error, not a silently-ignored global. On
success, `main` reads the cell; if it is non-zero, `main` turns the
success into a failure carrying a private sentinel, marked with
`CliRuntime.reported(sentinel, code)`.

This exists because `process.exitCode` cannot be trusted to reach
teardown. Node's `runMain` skips `process.exit(0)` on success — it calls
`process.exit` only when the fiber received a signal or its own exit code
is non-zero (`@effect/platform-node-shared` `NodeRuntime.ts:58-65`) — so a
handler that only sets `process.exitCode` on an otherwise-successful fiber
relies on Node's own process-exit machinery to eventually notice that
field, well after Effect's own finalizers had their chance to run.
Turning the non-zero code into a failure instead routes it through core's
`defaultTeardown` on any runtime, exactly like an ordinary error, so
finalizers run before the process exits with the recorded code. `main`
packages no numeric taxonomy beyond 64 ([D7](../decisions/usage-exit-code-defaults-to-64.md))
and 130 (signal interrupt); codes 1 to 3 stay each consumer's own to
assign.

### `reportFailures` never renders `ShowHelp`

`Command.runWith` already printed the help text or the parse errors before
a `ShowHelp` reaches `reportFailures` (`Command.ts:1958-1964`) — rendering
it a second time is what produced the stray "Help requested" line every
consumer previously worked around by hand. `reportFailures` now never
renders a `ShowHelp`, and never renders the `CliExit` sentinel either. It
still renders every other `errorReported: false` error: schemastore-cli's
`GateError` summary relies on that render path staying intact. A
`ShowHelp` that carries errors is remapped to `usageExitCode`
([D7](../decisions/usage-exit-code-defaults-to-64.md), default 64); a bare
`--help` invocation (`ShowHelp` with no errors) keeps exit 0.

### The renderers

`SchemaIssueRenderer` wraps `SchemaIssue.makeFormatterStandardSchemaV1`
rather than reimplementing it. Its job is discoverability, deduplication —
a three-member union otherwise prints the same unknown-key line three
times, once per member — and one phrasing override: core's `UnexpectedKey`
message is `"Expected no excess property"`, which describes the schema's
rule rather than the user's mistake, so it is rewritten to `unknown key
"rulesetz"`.

`ConfigIssueRenderer` is the same treatment for
`@effected/config-file`'s `ConfigValidationError`, whose `issue` tree is the
same shape. It is the reason this package peers on `@effected/config-file`
rather than the other way around: rendering is presentation and belongs at
the boundary.

**`@effected/config-file` is an optional peer**
(`peerDependenciesMeta.optional: true`), mirroring `@effected/markdown`'s
arrangement with `jsonc`/`toml`/`yaml`. The manifest declaration is the easy
half; the load-bearing half is that `ConfigIssueRenderer` is its own module
that nothing but the entry point imports, with shared rendering in
`packages/cli/src/internal/format.ts`. An optional peer reached from a
shared module is not optional — it is a runtime crash for every consumer
who believed the manifest. This is verified by build, not by reading: every
runtime import in every emitted chunk must be `effect` or relative, and the
package's only references to `@effected/config-file` are comments and one
type-only import in the `.d.ts`. One consequence follows: because that
type appears in a public signature, a consumer who has not installed the
optional peer sees the type fail to resolve in that one module — harmless
at runtime, invisible under the common `skipLibCheck: true`, but real. This
is the kit's established trade — `@effected/markdown` ships the identical
pattern — not a new one: an optional peer buys install-time freedom and
costs type resolution in the module that names it.

## Decisions settled against core's source

See the linked Decisions for full reasoning:

- [the exit code is set through core's own error markers](../decisions/cli-exit-code-via-runtime-markers.md)
- [`CliLogger` honours `LogToStderr` in one direction only](../decisions/cli-logger-force-all-stderr-only.md)
- [the `Command` handler-accessor gap is filed upstream, not shimmed](../decisions/cli-handler-accessor-gap-filed-upstream.md)

## Errors

**No new error classes.** Everything here is presentation: it renders
errors other packages raise and must not wrap them. A renderer that fails
has a defect, not a domain error — a `SchemaIssue` tree that cannot be
rendered is a bug in the renderer.

## Observability

**No spans.** Rendering a string and writing a line are not operations an
operator traces, and a span around a logger write would appear in every log
line's own trace. The package stays telemetry-agnostic, like every library
in the kit.

## Testing

The `Console` reference makes the whole surface testable without stubbing
globals: provide a capturing `Console`, run the program, and assert on what
was written and on which stream — the property most worth pinning, since it
is the one that silently regresses and the one `mytool run > log.txt`
depends on. The discriminating mutant for `CliLogger` is routing everything
to stdout; a suite that still passes is asserting on content and not on
stream, which is half a test.

Drive levels with `References.MinimumLogLevel`, provided as a service.
`Logger.withMinimumLogLevel` does not exist on the v4 line and is the
obvious first reach — verified absent from core's `Logger.ts` rather than
assumed.

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`.

## Non-goals

See [the boundary limitation this package holds itself to](../limitations/cli-is-not-a-framework.md)
for the four things deliberately out of scope: argument parsing, a
platform package, interactive terminal UI, and a dependency edge from
anything but an application.

## Build

Standard package setup. Expected to need no API Extractor suppression: no
class factories here, so no synthesized `_base` symbol. Gate on a cold
`pnpm build --filter @effected/cli`, never the raw script.
