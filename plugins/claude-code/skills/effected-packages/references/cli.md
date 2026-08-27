# @effected/cli

The presentation boundary of a command-line program built on `effect/unstable/cli`: how output reaches a human, how a failure is reported, and how a schema or config issue becomes a sentence someone can act on. **It is not a CLI framework and must never grow into one** — `effect/unstable/cli` owns argument parsing, flags, the command tree and help, and core already ships `Prompt`. Boundary tier: `effect` is the only required peer, with **no platform package, required or optional** (a `@effect/platform-node` edge here would make the package unusable from Bun and Deno for no gain); `@effected/config-file` is an **optional** peer used by one module. Four exports, all presentation. Nothing in the kit may depend on it but an application — it and `@effected/app` are siblings, not layers.

What the four have in common: **a consumer only discovers the need by shipping bad output to a person.** None of them fails a type-check, a test, or a review of the call site.

## Import

```ts
import { CliLogger, CliRuntime, ConfigIssueRenderer, SchemaIssueRenderer } from "@effected/cli";
```

Single entrypoint; no subpaths. Defining commands, flags and help is `effect/unstable/cli`'s job, not this package's.

## Feature surface

| Reach for | When |
| --- | --- |
| `CliLogger.layer()` | a person is reading the output and Effect's default `[00:33:56.619] INFO (#2):` prefix is noise |
| `CliLogger.make()` | you are assembling the logger set yourself and want this one among several |
| `CliRuntime.reportFailures()` | an unhandled failure must be rendered through *your* logger, on stderr, with the right exit code |
| `CliRuntime.reported(error, code)` | your command already printed its own diagnostics and must not be reported twice |
| `SchemaIssueRenderer.render(issue)` | a `SchemaError`'s issue tree must become one actionable line per rejected value |
| `ConfigIssueRenderer.render(error)` | the same, for a `@effected/config-file` `ConfigValidationError` |

## Core API

- **`CliLogger`** — `CliLogger.layer(options?)` → `Layer.Layer<never>`, wrapping `Logger.layer([CliLogger.make(options)])`, which **replaces** the default logger rather than merging, so nothing is emitted twice. `CliLogger.make(options?)` → `Logger.Logger<unknown, void>` for composing a logger set by hand. `CliLoggerOptions` carries `render` (defaults to joining an array with spaces — `Effect.log` is variadic — and `String`-ing anything else) and `stderrFrom` (defaults to `"Error"`). Routing is **ordinal**, `LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)`, so the named level *and everything above it* go to stderr, including a level added upstream later. The logger reads `Console.Console` off the fiber — a `Context.Reference`, so it carries a default, never appears in `R`, and a test swaps it — because `Logger.make` takes a **synchronous** callback while a `Sink` write is an `Effect`, putting `Stdio` out of reach. `References.LogToStderr` is honoured in **one direction only**: it can force everything to stderr, and can never move an error back onto stdout. **Merge this layer into the one you provide to the whole program, not beneath it** — merged, it also covers lines emitted during layer construction, which is exactly where a startup failure prints.
- **`CliRuntime.reportFailures(options?)`** — a **combinator**, not a `runMain`: `<A, E, R>(effect) => Effect<A, Error, R>`. It catches the cause, renders it through the ambient logger with `Effect.logError` (one log call per line, so `render` may return `ReadonlyArray<string>`), and **re-fails** with a marked `Error` so the runtime still sees a failure and a broken run cannot exit `0`. An **interrupt-only cause is left alone** — the default teardown already maps it to `130`. `ReportFailuresOptions`: `render` (defaults to `String(error)`) and `exitCode` (the fallback only; an error carrying `Runtime.errorExitCode` keeps its own). Apply it *inside* the effect, before your platform's runner sees it: `NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)))`.
- **`CliRuntime.reported(error, exitCode = 1)`** → `Error` — stamps the two core marks on an error (wrapping a non-`Error` value in one). Exported for a command that prints its own diagnostics and must not be reported a second time.
- **`SchemaIssueRenderer.render(issue: unknown)`** → `ReadonlyArray<string>` — one line per rejected value, deepest path last, in the form `unknown key at groups.g.cleanup.rulesetz`. Takes **any** value and returns `[]` when it is not an issue tree: a renderer on an error path must never be the reason a program dies. It wraps core's `SchemaIssue.makeFormatterStandardSchemaV1` (with `defaultLeafHook` for every other leaf) plus one phrasing override — core says `"Expected no excess property"`, which describes the schema's rule rather than the user's mistake. Duplicate lines are collapsed: a union reports every branch it tried, so one wrong key in a three-member union would otherwise print the same line three times. **This export exists mostly to end a search** — core's formatters live on `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*`, and `SchemaError.message` does not use them, so printing the error hints at nothing.
- **`ConfigIssueRenderer.render(error: ConfigValidationError)`** → `ReadonlyArray<string>` — the same treatment for `@effected/config-file`'s typed error, taking the **error** (what `Effect.catchTag("ConfigValidationError", …)` hands you) rather than its `Schema.Defect`-typed `issue`. The parameter is the typed error deliberately: an earlier `ConfigValidationError | unknown` collapses to plain `unknown` in TypeScript and says nothing. The `import type` is erased at build time, so the runtime reach into the optional peer is **zero** — a consumer without it installed can import this module and call `render` on any value.

## Usage

```ts
import { CliLogger, CliRuntime, SchemaIssueRenderer } from "@effected/cli";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

const reported = program.pipe(
  CliRuntime.reportFailures({
    render: (error) =>
      typeof error === "object" && error !== null && "issue" in error
        ? [String(error), ...SchemaIssueRenderer.render(error.issue)]
        : String(error),
  }),
  Effect.provide(MainLive),
);

NodeRuntime.runMain(reported);
```

## Testing machinery

No exported doubles. The whole surface is testable without stubbing a global: provide a capturing `Console.Console` reference, run, and assert both **what** was written and **which stream** it went to. The discriminating mutant for `CliLogger` is "route everything to stdout" — a suite that still passes is asserting on content only, and `Warn` is the boundary level that catches it. Drive levels with `References.MinimumLogLevel` provided as a service: **`Logger.withMinimumLogLevel` does not exist on the v4 line**, and it is the obvious first reach.

## Gotchas

- **`Runtime.errorReported` has inverted polarity relative to its name.** The marker means "should this be reported", so `false` is what suppresses the runtime's own report; the intuitive `errorReported: true` produces exactly the double report it was meant to prevent.
- **`Runtime.getErrorExitCode` cannot decide a code alone** — it answers `1` both for an error marked `1` and for an unmarked one, so an `exitCode` option would silently override a deliberate `1`. Test for the marker with `Runtime.errorExitCode in error`.
- **A platform `runMain` reports through the *default* logger, on stdout.** `makeRunMain` composes its reporting `tapCause` around the already-provided effect, so a program that correctly installs `CliLogger` still prints its failures in the format that logger exists to replace. Nothing at the call site suggests this; only a failure reveals it. That is the entire reason `reportFailures` is a combinator applied inside the effect.
- **`ConfigIssueRenderer` must stay a module no other module imports.** An optional peer whose import is reachable from a shared module is not optional — it is a crash for every consumer who took the manifest at its word. Shared rendering lives in `internal/format.ts`; the entrypoint re-exporting `ConfigIssueRenderer` is fine. Verify with a build, not by reading: every runtime `import` in `dist/prod/npm/pkg/**/*.js` must be `effect` or a relative path.
