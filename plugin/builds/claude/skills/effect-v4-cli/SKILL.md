---
name: effect-v4-cli
description: Use when building or reviewing a command-line program on Effect v4 — effect/cli in core, its exit-code contract, and @effected/cli, the presentation boundary that decides who the output is for (human, agent, CI), keeps stdout clean, reports failures on stderr, and adds prompts, Ink screens and live progress views — a TUI, wizard, picker or interactive prompt, and the tests that drive them.
when_to_use: effect/cli, Command, Flag, Argument, @effect/cli, exit code, findings exit code, usage error, --format json, --version, stdout vs stderr, stdin, CliLogger, CliRuntime, CliExit, CliColor, CliTest, @effected/cli/testing, NO_COLOR, FORCE_COLOR, TERM=dumb, bin-only package, emitDts false, Command.Environment, ChildProcess vs Command, --agent, --human, --ci, audience, CliAudience, CliEnv, CliTheme, CliMessage, CliLog, Doc, Render, CliFailure, CliPrompt, prompt fallback, interactive, CliUi, @effected/cli/ui, Ink, Select, MultiSelect, Confirm, TextInput, live view, spinner, progress, DocView, UiProvider, CliUiTest, TestTerminal, TUI, terminal UI, wizard, picker, menu, checkbox, interactive prompt, key bindings, KeyTable, useKeys, Tabs, Viewport, CliUi.lazy, jsx react-jsx, React is not defined, CliUi.map, CliUi.lazyView, masked input, secret prompt, span trail, snapshot serializer
---

# Effect v4 CLIs

Core owns parsing: `effect/cli` is the whole framework — `Command`, `Flag`,
`Argument`, `Prompt`, help, exit-code mapping. It owns nothing about who reads
the output or how it reaches them. `@effected/cli` is the presentation
boundary that fills that gap: it decides the **audience** (a person, an agent,
a CI job), what the terminal can do, the theme, how a document and a failure
are drawn for that audience, and when a run may prompt. Its root is
React-free; interactive Ink screens and live views live behind
`@effected/cli/ui`, whose `ink` and `react` peers are optional. It is
deliberately not a second framework: it adds no parser and no command model.

The one wiring:

```ts
const root = Command.make("tool").pipe(
  Command.withSharedFlags(CliAudience.flags()),
  Command.withSubcommands([init, verify]),
)

NodeRuntime.runMain(
  CliRuntime.main(CliAudience.run(root, { version }), {
    platform: NodeServices.layer,
    env: { audienceEnvVar: "TOOL_AUDIENCE", log: { envVar: "TOOL_LOG_LEVEL" } },
  }),
)
```

| construct | import | reach for it when |
| --- | --- | --- |
| `Command`, `Flag`, `Argument`, `Prompt` | `effect/cli` | declaring the command tree, its flags, positional arguments and core's line prompts |
| `ChildProcess`, `ChildProcessSpawner` | `effect/process` | building or running a spawned command — **not** `effect/cli`'s `Command`, which only declares your own CLI |
| `CliRuntime.main`, `CliRuntime.reportFailures` | `@effected/cli` | assembling `main`: platform, environment, failure reporting through your own logger, and the process exit code |
| `CliAudience` | `@effected/cli` | `--audience`/`--human`/`--agent`/`--ci` on the root, resolved before core parses |
| `CliEnv` | `@effected/cli` | building audience, terminal, theme and links once, and deciding `CliInteractive` — normally via `main`'s `env`; `CliEnv.layerTest` fixes them in a test |
| `Audience`, `TerminalEnv`, `CurrentRuntimeEnv`, `EnvOverride` | `@effected/env` | reading who runs the program and what the terminal can do (colour level, width, hyperlinks) |
| `CliInteractive` | `@effected/cli` | asking whether this run may prompt a person |
| `CliTheme`, `Token`, `Status`, `Glyphs` | `@effected/cli` | painting by token, a typed status vocabulary, Unicode or ASCII glyphs |
| `CliMessage` | `@effected/cli` | a one-line themed outcome ("created 3 files") that no log level silences |
| `CliLog.status`, `CliTheme.forAudience` | `@effected/cli` | a status glyph that keeps its colour on the log channel; painting your own lines by the kit's audience rule |
| `Doc`, `Render`, `Fmt`, `CliLinks` | `@effected/cli` | building a report once and rendering it plain for agents, ANSI for people, markdown, or a GitHub Actions log |
| `CliFailure` | `@effected/cli` | drawing a failure as a document, or letting an error draw itself (`CliDoc`); its `in:` span trail (`spans`, `appModule`) |
| `CliLog` | `@effected/cli` | opt-in diagnostics: a level variable, NDJSON for agents and CI, a file sink, components |
| `CliLogger` | `@effected/cli` | the plain, level-routed logger on its own, for a program without `CliLog` |
| `CliExit` | `@effected/cli` | a findings command (a linter that found problems) exiting non-zero by succeeding, never by failing |
| `CliColor` | `@effected/cli` | the stdout colour decision as a boolean, and core's formatter coloured by it, in a program without `env` |
| `CliPrompt.fallback` | `@effected/cli` | a flag or argument that prompts with core's `Prompt` when missing — only when interactive |
| `CliUi`, `Select`, `TextInput`, `MultiSelect`, `Confirm` | `@effected/cli/ui` | an Ink screen from a handler (`prompt`) or as a fallback (`fallback`), with a non-interactive default |
| `CliUi.lazy` | `@effected/cli/ui` | mounting a screen of your own whose module holds the JSX, so a non-interactive run never loads React |
| `CliUi.map` | `@effected/cli/ui` | mapping a screen's answer, e.g. a `Confirm` behind a `--yes` boolean flag |
| `CliUi.live`, `CliUi.lazyView`, `DocView`, `UiProvider` | `@effected/cli/ui` | progress that redraws in place while work runs, its view loaded lazily and a `final` document for runs nobody watches, drawing the `Doc` IR inside Ink |
| `KeyTable`, `useKeys`, `KeyHelp`, `Styled`, `Viewport`, `Tabs` | `@effected/cli/ui` | writing your own screen: keys as data, themed text, a scrolling list, tabs |
| `CliTest`, `TestTerminal` | `@effected/cli/testing` | spawning a built bin hermetically; driving core prompts in a test |
| `CliUiTest` | `@effected/cli/ui/testing` | driving a screen or live view with keys and reading its frames and the terminal's transcript |
| `CurrentDistribution`, `distributionSuffix` | `@effected/engine` | a consumer front end's `--version` line needs the carrier it was installed through |
| `SourceBoundary` | `@effected/workspaces/testing` | pinning which files may read `process` in a CLI's own tests |

## Standards

- Build the CLI on `effect/cli`, never `@effect/cli` — its releases still peer on `effect ^3.x`.
- Wire every program the one way: share `CliAudience.flags()` on the root, run it with `CliAudience.run`, and pass `env` to `CliRuntime.main`.
- Give every `Flag.Boolean` an explicit `Flag.withDefault` or `Flag.optional` — omission is a usage error, not `false`.
- Provide `@effect/platform-node`'s `NodeServices.layer` once, as `main`'s `platform`, to satisfy `Command.Environment`.
- Fail a usage error (`Effect.fail(new CliError.UserError(...))`); succeed a query that legitimately matches nothing.
- Write program output with `Console.log` or `Doc.print`, one-line outcomes with `CliMessage`, and diagnostics with `Effect.log*` — the streams must never trade places.
- Build a report as a `Doc` and let the audience pick the renderer; reach for `Render.markdown` only for a file or a step summary.
- Ask for input only through `CliPrompt.fallback`, `CliUi.prompt` or `CliUi.fallback`, each with a non-interactive default.
- Set `"jsx": "react-jsx"` for a `.tsx` screen, keep each screen in its own module with a default export, and mount it with `CliUi.lazy`, so JSX never loads in the command module.
- Log through `handle.logConsole` while a live view is drawn, and not at all while a screen is mounted. Forward foreign output (a child's stderr) with `handle.printAbove(stream, line)`, which returns `false`, writing nothing, when no frame is mounted.
- Paint a status glyph on a diagnostic with `CliLog.status`, and apply the audience rule to your own lines with `CliTheme.forAudience`; never copy the rule or hand-paint a glyph into `Effect.log*` (the logger strips it).
- Pass `env: { appModule: import.meta.url }` to `CliRuntime.main` from a bin that is installed under `node_modules/@effected/`, so the failure report's span trail keeps its own spans.
- Give a live view `render: CliUi.lazyView(() => import("./view.js"))` and a `final` document, so `--help`, agent, CI and piped runs never load React or Ink.
- Report findings by succeeding and calling `CliExit.set(code)`, never by failing or calling `process.exit` in a handler.
- Set `emitDts: false` in `savvy.build.ts` for a package whose `exports` is `"./package.json"` only.
- Confine every `process` read (`env`, `argv`, `cwd`, `execPath`, `isTTY`) to `bin.ts`, `main.ts` or `version.ts`; pass it down as a plain value.

## Footguns

- No v4 line of `@effect/cli` exists — see `core-framework.md`.
- `Flag.Boolean` has no implicit `false`; omission is `MissingOption` — see `core-framework.md`.
- `CliRuntime.main` without `env` builds no environment: `CliInteractive` stays `false` and nothing ever prompts — see `presentation.md`.
- `CliAudience.provide` alone misses fallback prompts and the failure report; use `CliAudience.run` — see `presentation.md`.
- `CliUi.prompt` without `otherwise` keeps `NotInteractive` in its error type; a `CliUiTest.session` is 80 columns and truncates rows; `session.layer` goes inside `CliEnv.layerTest` — see `prompts-and-screens.md`, `testing-a-cli.md`.
- Top-level `Doc` blocks print with no blank line between them; wrap in `Doc.section(undefined, [...])` — see `presentation.md`.
- `FORCE_COLOR` beats `NO_COLOR`, and a terminal with no `TERM`/`COLORTERM` gets no colour — see `presentation.md`.
- `TERM=dumb` is not interactive: it gets what a pipe gets — see `presentation.md`.
- An agent audience never gets an escape, even from an explicit `Render.ansi` — see `presentation.md`.
- Under `env`, `main`'s formatter shadows one the platform sets; override through `env.formatter` — see `recipes.md`.
- A `Logger.layer([...])` of your own beside `CliLog` replaces its whole logger set and silences diagnostics — see `presentation.md`.
- JSX or an `ink`/`react` import in the module that declares your commands loads React on every run, `--agent` and CI included; `@effected/cli/ui` itself never does — see `prompts-and-screens.md`.
- `"jsx": "react"` (classic) crashes a screen at mount with `React is not defined` — see `prompts-and-screens.md`.
- A cancel in a fallback prompt is a defect a handler's `catchTag` cannot see; `main` renders it, exit `130` — see `prompts-and-screens.md`.
- A line written while a screen is mounted tears the frame (`patchConsole` is off) — see `prompts-and-screens.md`.
- A screen that awaits another `CliUi.run` deadlocks, and `Confirm`'s `otherwise` is a whole `{ confirmed, toggles }`, never a boolean (wrap it in `CliUi.map` for a boolean flag) — see `prompts-and-screens.md`.
- Ink delivers a whole stdin read of keys before React re-renders; a handler must step from current state — see `prompts-and-screens.md`.
- React error boundaries do not catch errors thrown in Ink `useInput`/`usePaste` handlers — see `prompts-and-screens.md`.
- `CliUiTest`'s `press("y")` dies (send `type("y")` or `press({ char: "y" })`), its waits are real time (`it.live` for a test that sleeps), and under `main` with `env` the session's `interactive` is shadowed by `CliEnv` — see `testing-a-cli.md`.
- A `TextInput` `mask` predicate latches from its first `true` until the value is emptied; match the giveaway anywhere (`/gh[pousr]_|github_pat_/`), never as a prefix, and never echo the value in a `validate` message, which is drawn unmasked — see `prompts-and-screens.md`.
- A share headline (`1/3 repos`) reads a `{ one, other }` label by the total, a standalone count by its own `n` — see `presentation.md`.
- The failure report's span trail defaults to `spans: "app"`, which leaves out spans defined under `node_modules/@effected/` and `node_modules/effect/`; a bin installed there without `appModule` loses its own spans too — see `presentation.md`.
- A human whose stream is not a terminal (`tool | grep`) gets an unbounded width; to keep one line whole at a narrow terminal, use `Doc.line(content, { wrap: false })` — see `presentation.md`.
- Keep a live view's `LiveOptions` in a module the view does not import, or Biome's `noImportCycles` flags `CliUi.lazyView`'s dynamic import — see `live-view.md`.
- `CliUiTest.session`'s `layer` is typed `Layer<CliTheme>` but also supplies the streams and `CliInteractive` as references: provided where a presentation layer shadows it, it falls back quietly to the real streams — see `testing-a-cli.md`.
- `PubSub.shutdown` and a bare scope close drop a live view's tail; end with `handle.close` or `PubSub.end` — see `live-view.md`.
- A live view fed a forking stream subscribes late; pass the `PubSub.Subscription` itself — see `live-view.md`.
- The default logger and `runMain`'s failure report both land on stdout, not stderr — see `output-and-logging.md`.
- `errorReported: false` is what SUPPRESSES the runtime's own log, not what causes it — see `output-and-logging.md`.
- `Cannot merge zero API models` means the package needs `emitDts: false`, not an `index.ts` — see `bin-only-package.md`.
- A no-match result must succeed; only a usage error may fail — see `exit-codes.md`.
- `it.effect` starts `TestClock` at the epoch, and `TestConsole.logLines` accumulates across a whole test — see `testing-a-cli.md`.
- `Command.provide` builds its layer before the handler runs — a handler cannot pre-flight the value the layer depends on — see `gotchas.md`.
- `Flag.File(name, { mustExist: true })` fails at parse time (a usage error, exit `1` under a bare `runMain`, `64` under `CliRuntime.main`), not as your own infrastructure error — see `gotchas.md`.
- Two optional positionals bind in declaration order — the first one gets a lone argument, not whichever one "makes sense" — see `gotchas.md`.
- `Schema.decodeUnknownSync` in a handler throws a defect, invisible to `catchTag` — use `Schema.decodeUnknownEffect` — see `gotchas.md`.
- `Runtime.getErrorExitCode` returns `1` for both "marked 1" and "unmarked" — test the marker with `Runtime.errorExitCode in error` — see `gotchas.md`.
- `Argument.Path` resolves a relative value against the process's own cwd, at parse time — `Flag.Path`/`File`/`Directory` share the same behavior — see `gotchas.md`.
- The built-in global flags (`--help`, `--version`, `--wizard`, `--completions`, `--log-level`) are on by default, program-wide — trim them with `CliConfig.layer({ builtIns: [] })`, not per command — see `gotchas.md`.

## Additional resources

- [presentation.md](./references/presentation.md) — the one wiring, audience and `CliInteractive`, `CliEnv` and its options, colour precedence, the theme vocabulary, `CliMessage`, the `Doc` IR and renderers, the failure report and `CliLog`. Load when: wiring `main`, deciding which channel a line goes to, rendering a report, or customising the failure report or diagnostics.
- [prompts-and-screens.md](./references/prompts-and-screens.md) — setup (install line, peers, `jsx: react-jsx`), keeping React off non-interactive runs with `CliUi.lazy`, `CliPrompt.fallback` vs `CliUi`, the widgets and their options, a `Confirm` worked through (whole-`ConfirmResult` default, `CliUi.map` for a boolean flag), writing a screen with `KeyTable`/`useKeys`/`Viewport`/`Tabs`, and the rules that keep a screen from tearing the terminal. Load when: setting up Ink screens, asking a person for input, or writing or reviewing an Ink screen.
- [live-view.md](./references/live-view.md) — `CliUi.live`: runs, subscribing and ending without losing the tail, `logConsole`, non-interactive modes and the `final` document, a lazy view with `CliUi.lazyView`, `DocView` and `UiProvider`. Load when: drawing progress that updates in place, or hosting an Ink tree the kit did not mount.
- [core-framework.md](./references/core-framework.md) — the module inventory, PascalCase constructors, `Flag.Boolean`'s missing default, `Command.Environment`, and the two different `Command`s. Load when: writing or reviewing the `Command`/`Flag`/`Argument` declaration itself.
- [output-and-logging.md](./references/output-and-logging.md) — the three defaults core gets wrong at a terminal, the `CliLogger` implementation facts, exit-code reporting, and `CliColor`. Load when: wiring a logger by hand, or debugging a duplicate or missing failure report.
- [bin-only-package.md](./references/bin-only-package.md) — `emitDts: false`, the `exports: "./package.json"` shape, and why `Cannot merge zero API models` is not an extractor bug. Load when: building a package whose only surface is a `bin`.
- [exit-codes.md](./references/exit-codes.md) — the exit-code contract, `CliRuntime.main`'s assembly order, the code table, and how a findings command exits non-zero by succeeding. Load when: deciding whether a code path should fail or succeed, assembling `main.ts`, or handling `CliError` exhaustively.
- [testing-a-cli.md](./references/testing-a-cli.md) — the two false-green traps, the `layerTest` doubles and a capturing `Console`, `TestTerminal`, `CliUiTest` for screens and live views (a worked `session` test of a whole wizard, the harness traps, the snapshot serializer), and `CliTest` for spawning a built bin. Load when: writing a test that asserts on CLI output, a prompt, a screen, a wizard, a live view, or a real subprocess's exit code and streams.
- [gotchas.md](./references/gotchas.md) — seven traps that pass a type-check and a casual run: `Command.provide`'s build order, `Flag.File`'s parse-time existence check, positional binding order, `decodeUnknownSync`'s defect, the exit-code marker, `Argument.Path`/`Flag.Path` resolution, and the on-by-default global flags. Load when: a handler isn't seeing the value you expect, or an exit code doesn't match what the handler did.
- [recipes.md](./references/recipes.md) — patterns the kit deliberately does not package: the main-assembly file layout, the version constant and formatter, the JSON failure tap, reading stdin safely, process confinement, and an injectable clock. Load when: wiring up a new CLI front end from scratch.

Anchors in this skill and its references cite the vendored tag at
`.repos/effect/packages/effect/src/`; a consumer without that tree searches
`node_modules/effect/src` by symbol name instead of by line number.

## Related skills

- **`effect-v4-module-index`** — which core module owns a capability, including
  `effect/process` and the `NodeServices.layer` boundary.
- **`effect-v4-idioms`** — `PlatformError`, typed errors and core patterns.
- **`effect-v4-services-layers`** — providing `Command.Environment` once at the
  boundary, and the memoization discipline.
- **`effect-v4-testing`** — `TestClock`, `TestConsole`, and proving a suite can fail.
- **`effected-packages`** — the `@effected/env` and `@effected/cli` rows and
  their construct index.
