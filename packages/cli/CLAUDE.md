# @effected/cli

The boundary layer of an `effect/unstable/cli` program: `CliLogger`,
`CliRuntime` (including `CliRuntime.main`), `CliExit`, `CliColor`,
`SchemaIssueRenderer`, `ConfigIssueRenderer` — plus a `./testing` subpath
exporting `CliTest`, for spawning a built bin hermetically in tests. Every
export but `CliTest` is presentation, and `CliTest` is test tooling behind
its own entrypoint so it never enters a CLI's runtime import graph.

**Design doc:** `@./okf/modules/cli.md` — Load when:
changing the public surface, the logger's stream routing, the failure-reporting
combinator or the renderers. It carries the reasoning this file only
states. The consumer record behind it is
`@./okf/consumers/reposets.md` — Load when: weighing a
new request against what the first consumer actually reported.

## The rule that defines scope

**Not a CLI framework.** `effect/unstable/cli` owns parsing, flags, the command
tree and help. If a change here starts to look like parsing, it belongs upstream
or nowhere. No prompts, no spinners — `Prompt` already exists in core.

Tier: **boundary**. No platform package, required or optional. The moment
`@effect/platform-node` appears here the package stops being usable from Bun and
Deno for no benefit.

**Nothing in the kit may depend on this but an application**, same posture as
`app`. The two are siblings, not layers — `app` is the control plane, `cli` the
presentation boundary, and neither imports the other.

## Load-bearing decisions

**`CliLogger` reads `Console.Console` off the fiber.** Not a style choice:
`Logger.make` takes a *synchronous* callback and a `Sink` write is an `Effect`,
so `Stdio` is unreachable from a logger. Writing to `process.stdout` would work
and is what the consumer did first — it drags a platform assumption into a
library and makes the stream split untestable, because asserting it means
stubbing a global inside a runner that writes to those same streams.
`Console.Console` is a `Context.Reference`, so it carries a default, never
appears in `R`, and a test swaps it.

**Compare levels ordinally, never by string equality.**
`LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)` is the test; `logLevel
=== "Error" || logLevel === "Fatal"` hard-codes two names and silently misses
any level above them, including one added upstream. `stderrFrom` defaults to
`"All"` and the threshold is the option (#716; breaking on the 0.x line).

**`LogToStderr` is honoured in one direction only.** It can force everything to
stderr; it must never move an error onto stdout. That is the one guarantee this
logger makes and a reference should not be able to revoke it.

**`CliRuntime` is a combinator, not a `runMain`.** The failure it fixes is
*where the report happens*: a platform `runMain` composes its reporting
`tapCause` around the already-provided effect, so the report runs outside your
layers and prints through the default logger on stdout. The fix has to happen
inside the effect. Wrapping `runMain` itself would drag a platform choice into
this package.

**`Runtime.errorReported` has inverted polarity relative to its name.** `false`
is what suppresses the runtime's own report; the marker means "should this be
reported". The intuitive `errorReported: true` — "I have reported it, stay
quiet" — produces exactly the double report it was meant to prevent. The test
for this is written so that flipping the source value **fails**, not so that it
merely records the current one.

**`getErrorExitCode` cannot be used alone to decide a code.** It answers `1`
both for an error marked `1` and for an unmarked one, so an `exitCode` option
would silently override a deliberate `1`. Test for the marker with
`Runtime.errorExitCode in error` to keep "the error chose" distinct from
"nothing chose".

**`reportFailures` never renders `ShowHelp`.** `Command.runWith` already
printed the help text or the parse errors before a `ShowHelp` reaches
`reportFailures`, so rendering it again produces nothing but a stray "Help
requested" line. A `ShowHelp` carrying parse errors is instead remapped to
`usageExitCode` (default `64`, BSD `EX_USAGE`); a bare `--help` or root
invocation — `errors` empty — keeps exit `0`.

**`CliRuntime.main` uses a private `ExitRequested` sentinel, not
`process.exitCode`.** Node's `runMain` skips `process.exit(0)` on success, so
a handler that only sets `process.exitCode` on an otherwise-successful fiber
relies on Node's own process-exit machinery to eventually notice that field —
well after Effect's finalizers had their chance to run, and not at all on a
non-Node runtime. `CliExit.set(code)` records a findings code instead; after
the program succeeds, `main` reads the cell and, if non-zero, fails with the
internal `ExitRequested(code)` sentinel — marked with `Runtime.errorReported:
false` so it routes through core's `defaultTeardown` like any other error,
with finalizers intact, on any runtime. `reportFailures` never renders it:
there is nothing to say, only an exit code a successful program already
chose. Nothing outside this package constructs or matches `ExitRequested`.

**`CliExit.layer` is `Layer.fresh`.** Every provide mints a new cell —
without `Layer.fresh`, layers memoize by reference across `Effect.provide`
calls, so a second provide anywhere in the program (a nested
`CliRuntime.main`, a test helper) would silently share the first run's cell
and inherit its code. **A program run under `CliRuntime.main` must NOT
provide `CliExit.layer` itself** — `main` already provides a fresh cell, and
a second provide creates a second, unrelated cell: `CliExit.set` calls made
against that shadow cell never reach the one `main` reads, and a findings run
silently exits `0`.

**`CliColor` reads `NO_COLOR` through `ConfigProvider`, never `process`.**
Follows the no-color.org rule: colour is off when stdout is not a terminal,
or `NO_COLOR` is set to any non-empty value; an empty `NO_COLOR=""` does not
disable colour. `FORCE_COLOR` is ignored, matching core's own formatter. The
environment read goes through the ambient `ConfigProvider`, so a test swaps
it with `Effect.provideService(ConfigProvider.ConfigProvider, ...)` instead
of mutating `process.env`.

**The `./testing` split has a reachability test.** `entrypoints.test.ts`
walks the import graph from `src/index.ts` and asserts nothing reachable from
it imports `CliTest` or `testing.ts`, with a positive control proving the
walker actually resolves imports (`./testing` DOES reach `CliTest`) and a
second control proving it resolves the main entry too (`index.ts` reaches
`CliRuntime`). A CLI that only imports `@effected/cli` therefore never pulls
test-spawning machinery — `effect/unstable/process`'s `ChildProcessSpawner`
included — into its runtime bundle.

## The optional peer, and the rule that makes it honest

`@effected/config-file` is a `workspace:^` peer with
`peerDependenciesMeta.optional: true`, consumed only by `ConfigIssueRenderer` —
the same arrangement `@effected/markdown` has with `yaml`/`toml`/`jsonc`.

**`ConfigIssueRenderer` must stay a module no other module imports.** An
optional peer whose import is reachable from a shared module is not optional; it
is a crash for every consumer who took the manifest at its word. Shared
rendering lives in `src/internal/format.ts`, which both renderers import and
neither re-exports. The entrypoint re-exporting `ConfigIssueRenderer` is fine.

Verify this with a build, not by reading: every runtime `import` in
`dist/prod/npm/pkg/**/*.js` must be `effect` or a relative path. The `.d.ts`
carries a type-only import of `ConfigValidationError`, which is erased.

## Testing

The whole surface is testable without stubbing globals: provide a capturing
`Console`, run, and assert on what was written **and on which stream**.

The discriminating mutant for `CliLogger` is **route everything to stdout**. A
suite that still passes is asserting on content and not on stream, which is half
a test — `Warn` is the boundary that catches it.

**Drive levels with `References.MinimumLogLevel`, provided as a service.**
`Logger.withMinimumLogLevel` **does not exist on the v4 line** and is the
obvious first reach. `@effect/vitest`, `it.effect`, `assert.*` — never
`expect`.

**Testing an actual built bin — a real subprocess, not the program in-process
— uses `@effected/cli/testing`'s `CliTest`.** `CliTest.sandbox({ path })`
mints a scoped temp directory with a fresh `HOME` and
`XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR: "1"`, and the `path` you
pass as `PATH` — the host environment is never inherited. `CliTest.run(bin,
args, { sandbox, execPath, cwd?, env?, stdin? })` spawns `execPath` with
`[bin, ...args]` over core's `ChildProcess`/`ChildProcessSpawner` and returns
`{ exitCode, stdout, stderr }` as data — a non-zero exit is never a failure.
**When `stdin` is omitted, or passed as `""`, the child receives an
already-ended empty input (`Stream.empty`), never an open pipe** — core's
default `"pipe"` stdio stays open until something writes to and ends it, so a
stdin-reading bin would otherwise hang the test.

```bash
pnpm vitest run packages/cli        # from the repo root
pnpm build --filter @effected/cli   # cold; never the raw savvy.build.ts
```
