# @effected/cli

Teaching skill: `effect-v4-cli`.

The presentation boundary of a command-line program built on `effect/cli`: who the output is for (a person, an agent, a CI job), what the terminal can do, how output is themed and rendered for that audience, how a failure is reported and exits, how diagnostics stay apart from output, and when a run may prompt. **It is not a CLI framework and must never grow into one** — `effect/cli` owns argument parsing, flags, the command tree, help and core's `Prompt`. Boundary tier for the root: `effect` and `@effected/env` (detection), `@effected/glob` and `@effected/walker` (editor-link project discovery) are required peers, `@effected/config-file` an **optional** peer used by one module, `@effected/github-commands` a regular dependency — and **no platform package, required or optional** (a `@effect/platform-node` edge would make the package unusable from Bun and Deno for no gain). `@effected/cli/ui` adds `ink` (^7.1.1) and `react` (^19.2.0) as optional peers, loaded only when a screen mounts; the root never reaches it. Nothing in the kit may depend on `cli` but an application or a companion (`schemastore-cli` imports the boundary root only) — it and `@effected/app` are siblings, not layers.

What the surface has in common: **a consumer only discovers the need by shipping bad output to a person or a machine.** None of it fails a type-check, a test, or a review of the call site.

## Import

```ts
import { CliAudience, CliEnv, CliExit, CliLog, CliMessage, CliRuntime, CliTheme, Doc, Render, Status } from "@effected/cli";
import { CliTest, TestTerminal } from "@effected/cli/testing"; // test-only
import { CliUi, Confirm, DocView, MultiSelect, Select, TextInput } from "@effected/cli/ui"; // needs ink + react
import { CliUiTest } from "@effected/cli/ui/testing"; // test-only
```

Four entrypoints. A reachability test proves nothing reachable from `.` imports `./testing` or `./ui`, so a program importing the root never loads test code or Ink.

## Setup

```sh
pnpm add @effected/cli @effected/env @effected/walker @effected/glob effect
pnpm add ink react                  # only for @effected/cli/ui
pnpm add -D @types/react @types/node
```

`@effected/env`, `@effected/walker` and `@effected/glob` are required peers of the root; `ink`, `react` and `@types/react` are optional peers for `./ui` only. A `.tsx` screen needs `"jsx": "react-jsx"` in its tsconfig (classic `"jsx": "react"` crashes at mount with `React is not defined`), and a module of your own that holds JSX or imports `ink` loads React whenever it loads — keep screens in their own modules and mount them with `CliUi.lazy` so `--agent` and CI runs never load React. Detail in `effect-v4-cli`'s `prompts-and-screens.md`.

## Feature surface

| Reach for | When |
| --- | --- |
| `CliRuntime.main(program, { platform, env })` | assembling a whole program: platform layer, environment services (`env`), fresh `CliExit`, failure reporting and the logger, in the one order that reports every failure well |
| `CliAudience.flags()` + `CliAudience.run(root, { version })` | `--audience`/`--human`/`--agent`/`--ci` shared on the root and resolved before core parses, so fallback prompts see them |
| `CliEnv.layer(options)` (or `main`'s `env`) | building `CurrentRuntimeEnv`, `TerminalEnv`, `Audience`, `CliTheme` and `CliLinks` once, deciding `CliInteractive`, and gating the terminal |
| `CliInteractive` | reading whether this run may prompt (human audience, terminals on stdin and stdout, `TERM` not `dumb`) |
| `CliTheme`, `Token`, `Status`, `Glyphs` | painting by token per stream, a typed status vocabulary, Unicode or ASCII glyphs |
| `CliMessage.success`/`info`/`warning`/`failure`/`status` | one themed outcome line through `Console`, never silenced by a log level |
| `Doc`, `Doc.print`, `Render.plain`/`ansi`/`markdown`/`githubLog`, `Fmt` | building a report once and rendering it for the audience; sanitised, and neutralized under GitHub Actions |
| `CliLinks` | file links that open in VS Code or as `file://`, never for an agent |
| `CliFailure.toDoc`, `CliDoc` | the default failure report as a document, or an error that draws itself |
| `CliLog.layer()` (or `env.log`) | opt-in diagnostics: a level variable, NDJSON for agents and CI, a file sink, components — owning the whole logger set |
| `CliLogger.layer()` | the plain, level-routed logger alone, when you are not using `CliLog` |
| `CliRuntime.reportFailures()` | an unhandled failure rendered through *your* logger, on stderr, with the right exit code, outside `main` |
| `CliRuntime.reported(error, code)` | your command already printed its own diagnostics and must not be reported twice — outside `reportFailures`/`main` only |
| `CliExit.set(code)` | a handler found findings and must exit non-zero without failing — under `CliRuntime.main` only |
| `CliColor.enabled` / `CliColor.formatterLayer()` | the stdout colour decision as a boolean, and core's formatter coloured by it, in a program without `env` |
| `CliPrompt.fallback(prompt, { flag, otherwise })` | a flag or argument that prompts with core's `Prompt` only when interactive |
| `Cancelled`, `NotInteractive` | the one quit error (exit `130`) and the prompt-without-a-person error (exit `64`) |
| `SchemaIssueRenderer.render(issue)` / `ConfigIssueRenderer.render(error)` | a schema or `@effected/config-file` issue tree as one actionable line per rejected value |
| `CliUi.prompt`/`fallback`/`run` + `Select`, `TextInput`, `MultiSelect`, `Confirm` | an Ink screen from a handler or as a fallback, with a non-interactive default (`Confirm`'s `otherwise` is a whole `{ confirmed, toggles }`) |
| `CliUi.lazy(() => import("./screen.js"))` | mounting a screen of your own whose module holds the JSX, loaded only when it mounts |
| `CliUi.live`, `DocView`, `UiProvider` | progress that redraws in place while work runs, drawing the `Doc` IR inside Ink |
| `KeyTable`, `useKeys`, `KeyHelp`, `Styled`, `Tabs`, `Toggle`, `Viewport` | writing your own screen |
| `CliTest.sandbox()` / `CliTest.run()` | spawning a **built** bin hermetically and reading its exit code and streams as data |
| `TestTerminal.make()` | driving core prompts in a test |
| `CliUiTest.render`/`view`/`session`/`live` | driving a screen, a whole wizard (`session`, run forked, `next` per screen) or a live view with keys and reading its frames; `CliUiTest.serializer` for snapshots |

The presentation layer and `./ui` are taught in depth in `effect-v4-cli` (`presentation.md`, `prompts-and-screens.md`, `live-view.md`, `testing-a-cli.md`); the API below is the boundary core those build on.

## Core API

- **`CliLogger`** — `CliLogger.layer(options?)` → `Layer.Layer<never>`, wrapping `Logger.layer([CliLogger.make(options)])`, which **replaces** the default logger rather than merging, so nothing is emitted twice. `CliLogger.make(options?)` → `Logger.Logger<unknown, void>` for composing a logger set by hand. `CliLoggerOptions` carries `render` (defaults to joining an array with spaces — `Effect.log` is variadic — and `String`-ing anything else) and `stderrFrom` (**defaults to `"All"`** — a CLI's stdout is its product, so every log level is a diagnostic unless narrowed; pass `"Error"` to send only errors to stderr and keep every lower level on stdout). Routing is **ordinal**, `LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)`, so the named level *and everything above it* go to stderr, including a level added upstream later. The logger reads `Console.Console` off the fiber — a `Context.Reference`, so it carries a default, never appears in `R`, and a test swaps it — because `Logger.make` takes a **synchronous** callback while a `Sink` write is an `Effect`, putting `Stdio` out of reach. `References.LogToStderr` is honoured in **one direction only**: it can force everything to stderr, and can never move an error back onto stdout. **Merge this layer into the one you provide to the whole program, not beneath it** — merged, it also covers lines emitted during layer construction, which is exactly where a startup failure prints. Program output belongs to `Console.log`, never `Effect.log` — under the new default, every `Effect.log*` call is a diagnostic.
- **`CliRuntime.reportFailures(options?)`** — a **combinator**, not a `runMain`: `<A, E, R>(effect) => Effect<A, Error, R>`. It catches the cause, renders it through the ambient logger with `Effect.logError` (one log call per line, so `render` may return `ReadonlyArray<string>`), and **re-fails** with a marked `Error` so the runtime still sees a failure and a broken run cannot exit `0`. An **interrupt-only cause is left alone** — the default teardown already maps it to `130`. It **never renders a `CliError.ShowHelp`** — `Command.runWith` already printed the help text or the parse errors before `ShowHelp` reaches it — nor the private `ExitRequested` sentinel `CliRuntime.main` raises, nor a `CliError.UserError` whose `Runtime.errorReported` mark is `false` — which is how `Command.runWith` leaves one it already printed, and indistinguishable from one marked with `reported` (such an error exits with its own `Runtime.errorExitCode` when it carries one, otherwise `usageExitCode`). Every other error renders even when already marked. `ReportFailuresOptions`: `render` (defaults to `String(error)`), `exitCode` (the fallback only; an error carrying `Runtime.errorExitCode` keeps its own), and `usageExitCode` (default `64`, BSD `EX_USAGE` — the code a `ShowHelp` carrying parse errors is remapped to; a bare `--help` or root invocation keeps exit `0`; with runWith's `renderErrors: false` parse errors print nothing, so keep the default). Both codes must be integers in `0..255`. Apply it *inside* the effect, before your platform's runner sees it: `NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)))`.
- **`CliRuntime.main(program, options: MainOptions<RP, EP>)`** → `Effect<void, Error, Exclude<Exclude<R, CliExit>, RP>>` — assembles a whole program in the one order that reports every failure well: provides a fresh `CliExit` (`Layer.fresh`, so it is never accidentally shared across a nested provide), then the required `platform: Layer<RP, EP>` layer **inside** `reportFailures` (so a platform build failure — `HOME` unset, say — renders as one line with the fallback code rather than escaping to the runtime's stack trace), then `reportFailures` itself, then the `logger` (defaults to `CliLogger.layer()`) **outermost**, so it is present whichever branch fails. After the program succeeds, `main` reads the `CliExit` cell; a non-zero code becomes a failure carrying a private `ExitRequested` sentinel that `reportFailures` never renders — there is nothing to say, only an exit code a successful program already chose. You still call your own platform's `runMain`.
- **`CliRuntime.reported(error, exitCode = 1)`** — stamps the two core marks on an error in place. Overloaded: `<E extends Error>(error: E, exitCode?): E` returns the very instance an `instanceof Error` caller passed, so `catchTags` keeps narrowing downstream without a cast; any other value falls to `(error: unknown, exitCode?) => Error` and is wrapped in a plain `Error`. Exported for a command that prints its own diagnostics and must not be reported a second time. **Under `CliRuntime.main`/`reportFailures`, do not print the failure yourself** — `reportFailures` renders every marked error again (only `ShowHelp`, a `UserError` whose mark is `false` and the `CliExit` sentinel are skipped); fail with it and put the multi-line rendering in the `render` option (the `ConfigIssueRenderer` pattern in the website's advanced guide, "Rendering a multi-line failure"). **A `CliError.UserError` marked with `reported` is treated as already printed and is not rendered — use a different error type if the program has not printed it**; its explicit code is kept (`reported(userError, 3)` exits `3`, not `usageExitCode`).
- **`CliExit`** — a `Context.Service<CliExit, { readonly code: MutableRef<number> }>()("@effected/cli/CliExit")`, deliberately a **service, not a reference**: forgetting to provide it is a type error, not a silently-ignored global. `CliExit.set(code)` takes an integer in `0..255` — anything else (`256`, `1.5`, `NaN`) dies as a defect, and `main` re-checks a code written to the cell directly — and records the **highest** code set during the run (highest-wins, not last-wins, so a later "clean" step cannot downgrade an earlier finding). `CliExit.layer` is `Layer.fresh(Layer.sync(...))` — **every provide mints a new cell**; a program run under `CliRuntime.main` must NOT provide `CliExit.layer` itself, or `CliExit.set` writes to a second, unread cell and the run silently exits `0`. Exists because `process.exitCode` cannot be trusted to reach teardown across every runtime with finalizers intact — see `CliRuntime.main`.
- **`CliColor`** — `CliColor.enabled: Effect<boolean, never, Stdio>` is `@effected/env`'s `TerminalEnv.colorLevel("stdout") !== "none"`, following Node's `getColorDepth` precedence: **`FORCE_COLOR`, when set, decides alone and beats `NO_COLOR`** (`""`/`1`/`true` on, `2`/`3` deeper, anything else off); otherwise no colour without a terminal; otherwise a non-empty `NO_COLOR` (an empty `NO_COLOR=""` does not count), `NODE_DISABLE_COLORS` or `TERM=dumb` turn it off and the terminal table (`TERM`, `COLORTERM`, `TERM_PROGRAM`, CI) decides. The environment is read through the ambient `ConfigProvider`, never `process`, so a test swaps the provider; an ambient `TerminalEnv` answers instead when provided. `CliColor.formatterLayer(overrides?)` → `Layer<never, never, Stdio>` builds core's `CliOutput.defaultFormatter({ colors })` from that same decision — `overrides` replaces individual formatter methods (e.g. `formatVersion`) without losing the rest. Each call mints a fresh layer; bind it to a `const`. Under `CliRuntime.main` with `env`, `main` installs this formatter itself (closer to the program than the platform); pass overrides as `env.formatter`.
- **`SchemaIssueRenderer.render(issue: unknown)`** → `ReadonlyArray<string>` — one line per rejected value, deepest path last, in the form `unknown key at groups.g.cleanup.rulesetz`. Takes **any** value and returns `[]` when it is not an issue tree: a renderer on an error path must never be the reason a program dies. It wraps core's `SchemaIssue.makeFormatterStandardSchemaV1` (with `defaultLeafHook` for every other leaf) plus one phrasing override — core says `"Expected no excess property"`, which describes the schema's rule rather than the user's mistake. Duplicate lines are collapsed: a union reports every branch it tried, so one wrong key in a three-member union would otherwise print the same line three times. **This export exists mostly to end a search** — core's formatters live on `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*`, and `SchemaError.message` does not use them, so printing the error hints at nothing.
- **`ConfigIssueRenderer.render(error: ConfigValidationError)`** → `ReadonlyArray<string>` — the same treatment for `@effected/config-file`'s typed error, taking the **error** (what `Effect.catchTag("ConfigValidationError", …)` hands you) rather than its `Schema.Defect`-typed `issue`. The parameter is the typed error deliberately: an earlier `ConfigValidationError | unknown` collapses to plain `unknown` in TypeScript and says nothing. The `import type` is erased at build time, so the runtime reach into the optional peer is **zero** — a consumer without it installed can import this module and call `render` on any value.
- **`TestTerminal`** (`@effected/cli/testing`) — `TestTerminal.make({ columns?, rows? })` → a handle with `layer` (a `Terminal`), `input(keys)`, `type(text)`, `end`, `output`, `pending` and `reads` (`{ keys, lines, subscriptions }`, to prove a non-interactive run never read). Core's own mock terminal is test-only and unexported.
- **`CliTest`** (`@effected/cli/testing`, a separate entrypoint — a reachability test proves nothing reachable from `.` imports it) — `CliTest.sandbox({ path }): Effect<Sandbox, PlatformError, FileSystem | Path | Scope>` mints a scoped temp directory with a fresh `HOME` and `XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR: "1"`, and `path` as `PATH` — the host environment is never inherited. `CliTest.run(bin, args, { sandbox, execPath, cwd?, env?, stdin? }): Effect<RunResult, PlatformError, ChildProcessSpawner>` spawns `execPath` with `[bin, ...args]` over core's `ChildProcess`/`ChildProcessSpawner` (no `@effected/commands` peer) and returns `{ exitCode, stdout, stderr }` as **data** — a non-zero exit is never a failure. **When `stdin` is omitted, or passed as `""`, the child receives an already-ended empty input**, never an open pipe — core's default `"pipe"` stdio stays open until something writes to and ends it, so a stdin-reading bin cannot hang the test.

## Usage

```ts
import { CliLogger, CliRuntime, SchemaIssueRenderer } from "@effected/cli";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

declare const AppLive: Layer.Layer<never>;
declare const program: Effect.Effect<void, unknown>;

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

No exported doubles for `CliLogger`/`CliRuntime` — the whole surface is testable without stubbing a global: provide a capturing `Console.Console` reference, run, and assert both **what** was written and **which stream** it went to. The discriminating mutant for `CliLogger` is "route everything to stdout" — a suite that still passes is asserting on content only, and `Warn` is the boundary level that catches it. Drive levels with `References.MinimumLogLevel` provided as a service: **`Logger.withMinimumLogLevel` does not exist on the v4 line**, and it is the obvious first reach. For an actual spawned-subprocess test — proving a **built** bin behaves correctly, not the program in-process — reach for `CliTest` behind `@effected/cli/testing`.

## Gotchas

- **`CliRuntime.main` without `env` builds no environment.** `CliInteractive` keeps its default `false`, so the program compiles, runs and never prompts; `CliMessage`, `Doc.print` and the screens also need the services `env` provides.
- **An agent audience never receives an escape** — no colour, no hyperlink, even through an explicit `Render.ansi` — and its renders are unbounded in width.
- **A `Logger.layer([...])` of your own beside `CliLog` replaces its whole logger set**, and the diagnostics go silent with no error.
- **`Runtime.errorReported` has inverted polarity relative to its name.** The marker means "should this be reported", so `false` is what suppresses the runtime's own report; the intuitive `errorReported: true` produces exactly the double report it was meant to prevent.
- **`Runtime.getErrorExitCode` cannot decide a code alone** — it answers `1` both for an error marked `1` and for an unmarked one, so an `exitCode` option would silently override a deliberate `1`. Test for the marker with `Runtime.errorExitCode in error`.
- **A platform `runMain` reports through the *default* logger, on stdout.** `makeRunMain` composes its reporting `tapCause` around the already-provided effect, so a program that correctly installs `CliLogger` still prints its failures in the format that logger exists to replace. Nothing at the call site suggests this; only a failure reveals it. That is the entire reason `reportFailures` is a combinator applied inside the effect.
- **`stderrFrom` defaults to `"All"`, not `"Error"`.** Every log level is a diagnostic unless a consumer narrows the threshold — program output belongs to `Console.log`, never `Effect.log`. Code expecting only `Error` and above on stderr silently finds `Info`/`Warning` lines there too.
- **Never provide `CliExit.layer` inside a program run under `CliRuntime.main`.** `main` already provides one fresh cell (`Layer.fresh`); a second provide anywhere in the program creates a second, unrelated cell, and `CliExit.set` calls against it never reach the one `main` reads back — a findings run silently exits `0`.
- **`reportFailures` never renders `CliError.ShowHelp` or the `CliRuntime.main` `ExitRequested` sentinel.** `Command.runWith` already printed help/parse errors before `ShowHelp` reaches it; rendering it again produces a stray "Help requested" line. `ExitRequested` carries only an exit code a *successful* program already chose — there is nothing to say.
- **`ConfigIssueRenderer` must stay a module no other module imports.** An optional peer whose import is reachable from a shared module is not optional — it is a crash for every consumer who took the manifest at its word. Shared rendering lives in `internal/format.ts`; the entrypoint re-exporting `ConfigIssueRenderer` is fine. Verify with a build, not by reading: every runtime `import` in `dist/prod/npm/pkg/**/*.js` must be `effect` or a relative path.
