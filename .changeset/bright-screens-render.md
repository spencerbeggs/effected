---
"@effected/cli": minor
---

## Breaking Changes

On the `0.x` line breaking changes ship as `minor`; the changes below can need action on upgrade.

### New peers and dependencies

- `@effected/env`, `@effected/walker` and `@effected/glob` are new **required** peers. Declare them beside `@effected/cli`: as regular dependencies in a bin or tool, as peers in a library.
- `@effected/github-commands` is a new regular dependency; nothing to declare unless you import it yourself.
- `ink`, `react` and `@types/react` are **optional** peers, needed only for the new `@effected/cli/ui` entrypoint. The package root and `./testing` never load them.

### `CliColor` follows Node's colour precedence

`CliColor.enabled` now decides through `@effected/env`, using Node's `getColorDepth` rules:

- `FORCE_COLOR` is honoured and beats `NO_COLOR`; it forces colour even without a terminal, and `FORCE_COLOR=0` forces it off.
- `NODE_DISABLE_COLORS` and `TERM=dumb` turn colour off, as a non-empty `NO_COLOR` already did.
- On Windows (`OS=Windows_NT`), a terminal gets truecolor, as Node gives on Windows 10 build 14931 and later.
- Elsewhere, a terminal Node's table does not recognise (no `TERM`, `COLORTERM` or known `TERM_PROGRAM`) gets no colour, as in Node.

A harness that checks for escape-free output without a terminal should pin `FORCE_COLOR=0`, since a `FORCE_COLOR` inherited from CI now colours the output.

### The default failure report is a document

Without a `render` option, `CliRuntime.reportFailures` and `CliRuntime.main` no longer print `String(error)`. They print `CliFailure.toDoc(cause)`, rendered for the audience:

- a status line (`✗ Error: boom`, or `[FAIL] Error: boom` when no environment services are provided);
- for a defect, a cleaned stack of file links, with `node_modules` and runtime frames hidden and counted (`env.stackFrames: "all"` keeps every frame);
- a schema failure as a tree.

The report is still written through the logger, and exit codes are unchanged. Tests asserting the exact line `Error: boom` need updating.

- `FailureDetails` gains two required members, `defaultLines` and `lines({ status? })`: the report the kit would write, with the run's colour, links and `displayPath`. A hand-built `FailureDetails` literal (typically in a test of your `render`) must supply them.
- `CliRuntime.defaultRender(error, details, { status? })` is now exported and returns plain lines.

### Log text is sanitised

`CliLogger` now removes escape sequences and control characters from what a program logs: a line break stays one and a tab becomes a space. A custom `render` receives the string parts already sanitised. This changes bytes in plain output, agent output included, for any log message that carried a tab or an escape. Under GitHub Actions, a line the runner would read as a workflow command is also neutralized.

### `CliRuntime.main` builds the platform under the logger

The platform layer is now built under `CliLogger`, so log lines it writes while building go to stderr rather than stdout. Lines returned by a consumer `render` are neutralized under GitHub Actions and stripped of escapes for an agent or CI audience.

## Features

`@effected/cli` grows from a failure-reporting boundary into the presentation layer of an `effect/cli` program. It decides the **audience** (a person, an agent or a CI job), what the terminal can do, the theme, how a document and a failure are drawn for that audience, and when a run may prompt. It still adds no parser and no command model: `effect/cli` owns those.

### The one wiring

```ts
import { CliAudience, CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/cli";

const root = Command.make("tool").pipe(
  Command.withSharedFlags(CliAudience.flags()),
  Command.withSubcommands([init, verify]),
);

NodeRuntime.runMain(
  CliRuntime.main(CliAudience.run(root, { version: "1.0.0" }), {
    platform: NodeServices.layer,
    env: { audienceEnvVar: "TOOL_AUDIENCE", log: { envVar: "TOOL_LOG_LEVEL" } },
  }),
);
```

`CliRuntime.main`'s new `env` option builds the `@effected/env` services, the theme, editor links and interactivity once, inside failure reporting. It also accepts `formatter`, `displayPath`, `stackFrames`, `editorLinks` and `stderrIsTerminal`.

### Audience and interactivity

- `CliAudience.flags()` adds `--audience`, `--human`, `--agent` and `--ci` as shared root flags; a repeated or conflicting flag exits `64`. `--audience` lists its choices once in help. `CliAudience.run` resolves the audience before core parses, so parse-time fallback prompts see it. A root without the flags is a compile error.
- `CliEnv.layer` builds the environment outside `main`; `CliEnv.layerTest({ tty, term, audience, columns, color })` fixes it in a test.
- `CliInteractive` says whether a run may prompt. It defaults to `false`, so a forgotten wiring never prompts. A pipe, an agent, CI and `TERM=dumb` are not interactive.
- `CliPrompt.fallback` makes a core `Prompt` the fallback for a missing flag or argument, only when interactive, with an `otherwise` value. `Cancelled` (exit `130`) and `NotInteractive` (exit `64`) report themselves in one fixed line. Non-interactive runs never attach to the terminal, so piped stdin stays readable.

### Theme

- `CliTheme` paints by token: `success`, `failure`, `warning`, `info`, `error`, `muted`, `accent`, `emphasis`. `Token.hex`, `Token.named` and `Token.style` build styles; `NamedColor` uses chalk and Ink spelling (`redBright`, `blackBright`, `gray`), and a name outside it paints nothing.
- `Status.core` is the shared status vocabulary (`success`, `skip`, `pending`, `info`, `warning`, `failure`), and `Status.extend` adds your own with typed names and severity folding. `Glyphs` switches to ASCII under `TERM=dumb`.
- `CliMessage.success`, `info`, `warning`, `failure` and `status` write one themed outcome line that no log level silences.

### Documents and renderers

- `Doc` is a plain-data document model: headings, paragraphs, lists, tables, counts and counts tables, trees, collapsibles, code and diff blocks, strong and emphasis text, and links.
- `Doc.print` picks the renderer by audience: ANSI for a person, plain for an agent, a GitHub Actions log under Actions, and plain for other CI. `Render.plain`, `Render.ansi`, `Render.markdown` (for a step summary or a file) and `Render.githubLog` are pure functions of a document and a `RenderContext`, built with `Render.context` or `Render.contextOf`.
- A table with no header text and no rows draws nothing in every renderer, or only its overflow line when a cap hid rows, so an empty `Doc.countsTable([])` is safe to print.
- `CliLinks` turns file targets into OSC 8 links for people only: `vscode://file/…` when a `.vscode/` directory sits at the workspace or git root, `file://` otherwise.
- `CliFailure.toDoc` draws a failure as a document, and the `CliDoc` protocol lets your own error class supply its document.
- `Fmt` adds width-aware `truncate`, `width`, `duration`, `percent`, `plural` and `sanitize`. `GithubAnnotation` writes `::error file=…,line=…::` annotation lines.

```ts
import { CliExit, CliMessage, Doc } from "@effected/cli";
import { Effect } from "effect";

const report = Effect.gen(function* () {
  yield* CliMessage.info("syncing 2 repositories");
  yield* Doc.print([
    Doc.table(
      [{ header: "Repository" }, { header: "Files", align: "right" }],
      [
        ["acme/widgets", "12"],
        ["acme/gadgets", "3"],
      ],
    ),
  ]);
  yield* CliMessage.warning("acme/gadgets has no default branch");
  yield* CliExit.set(1);
});
```

### Output safety

- An agent audience never receives an escape sequence of any kind, even from an explicit `format: "ansi"` or a live view's own colours.
- Under GitHub Actions, every kit path that writes text it did not author neutralizes workflow commands: `Doc.print`, `Render.*` through a context, `CliMessage`, the failure report (a consumer `render` included), `CliLogger`, `CliLog`, and every frame of a live view. In `CliLog`'s NDJSON, a `##[` inside a record is written as the JSON escape `##[`, which decodes to the same text.

### Logging

`CliLog.layer` is opt-in diagnostics that owns the logger set: a level variable (`envVar`) or fixed `level`, `format: "auto" | "json" | "pretty"`, an optional file sink, `CliLog.component` prefixes and `extraLoggers`. With `format: "auto"` the audience decides: NDJSON for an agent or CI, plain text for a person. `plainLogger: false` keeps diagnostics only. Use it instead of `CliLogger.layer`, never beside it; `CliRuntime.main` builds it from `env.log`.

### Interactive screens: `@effected/cli/ui`

- `CliUi.run` runs an Ink screen as a scoped Effect; `CliUi.prompt` asks from a handler with an `otherwise` value, and `CliUi.fallback` asks for a missing flag.
- Widgets: `Select`, `MultiSelect`, `Confirm` with `Toggle` rows, `TextInput`, `Tabs`, `Viewport` and `KeyHelp`. Your own screens use `KeyTable` and `useKeys` for keys, and `Styled`, `useTheme`, `useGlyphs` and `useTerminalSize` for the theme.
- Raw mode, the cursor and bracketed paste are restored on every exit, including a crash or an interrupt.
- `CliUi.live` folds a `Stream` or a `PubSub` subscription of events into state and draws each run in place while it goes. Log lines go above the frame through `handle.logConsole`, and `handle.close` folds everything still queued. When nobody is watching (a pipe, an agent, CI, `TERM=dumb`), each run's final frame prints once instead.
- `DocView` draws a `Doc` inside Ink exactly as `Doc.print` would, and `UiProvider` with `CliUi.context` gives an Ink tree you mount yourself the same theme.

```tsx
import { CliUi, Select } from "@effected/cli/ui";

const pickProfile = Select.screen({
  message: "Profile",
  choices: [
    { label: "library", value: "library" },
    { label: "application", value: "application" },
  ],
});

const profile = CliUi.prompt(pickProfile, { otherwise: "library" });
```

### Testing

- `@effected/cli/testing` adds `TestTerminal`, which drives core prompts with keys in a test.
- `@effected/cli/ui/testing` adds `CliUiTest`: `render` mounts a screen on in-memory streams (`press`, `type`, `chunk`, `frame`, `result`), `view` mounts a display-only element, `session` drives a whole command's screens, and `live` runs a live view on the production render path with a `TestClock` tick. `CliUiTest.serializer` is a Vitest snapshot serializer for styled frames.
