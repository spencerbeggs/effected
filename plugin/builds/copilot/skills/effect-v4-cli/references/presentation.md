# The presentation layer: audience, environment, theme, documents, diagnostics

Loaded from `effect-v4-cli`. Covers who a run's output is for and how it is drawn: the audience flags, `CliEnv`, colour, the theme vocabulary, `CliMessage`, the `Doc` IR and its renderers, the failure report, and `CliLog` diagnostics. Every signature here is `@effected/cli`'s root entrypoint unless it names `@effected/env`.

## The one wiring

```ts
import { CliAudience, CliRuntime } from "@effected/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Command } from "effect/cli"

declare const init: Command.Command<"init", {}, {}, never, never>
declare const verify: Command.Command<"verify", {}, {}, never, never>

const root = Command.make("tool").pipe(
  Command.withSharedFlags(CliAudience.flags()),
  Command.withSubcommands([init, verify]),
)

NodeRuntime.runMain(
  CliRuntime.main(CliAudience.run(root, { version: "1.0.0" }), {
    platform: NodeServices.layer,
    env: { audienceEnvVar: "TOOL_AUDIENCE", log: { envVar: "TOOL_LOG_LEVEL" } },
  }),
)
```

Three pieces, each load-bearing:

- **`Command.withSharedFlags(CliAudience.flags())`** adds `--audience <human|agent|ci>`, `--human`, `--agent` and `--ci` to the root. `CliAudience.flags({ hidden: true })` keeps them out of every help screen. Core lists a shared flag in every subcommand's help as well as the root's; that is upstream behaviour, not something to work around.
- **`CliAudience.run(root, { version })`** (or `runWith(root, config)(argv)`) scans argv for the four flags **before core parses**, so a fallback prompt that fires during parsing already sees the flag. It applies `CliAudience.provide` itself. A root that forgot the shared flags **does not compile** (`RequiresAudienceFlags`).
- **`CliRuntime.main(program, { platform, env })`** builds the environment services from `env` inside failure reporting, next to the platform, and installs a coloured `CliOutput.Formatter` so help text follows the same colour decision. **Without `env`, nothing is built and `CliInteractive` keeps its default of `false`**: the program compiles, runs, and never prompts.

More than one audience flag is a usage error (exit `64`) even when they agree, and `--no-agent`/`--agent=false` count as not given. A conflicting audience alongside `--help` still prints help and exits `0`, because core handles its action flags before the resolver runs.

`CliAudience.provide` on its own is the path for a bare `Command.run` only, and there it covers the subcommand handler but **not** a fallback prompt or the failure report: core parses root flags into a local context first. Use `run`/`runWith`.

## Audience and interactivity

`@effected/env`'s `Audience` is `{ kind: "human" | "agent" | "ci", source: "override" | "detected" | "flag" }`. Precedence: an audience flag, then a valid value in the override variable you name (`env.audienceEnvVar`), then agent detection, then CI detection, then human. **An agent running inside a CI job is an agent.** `Audience.detect(runtimeEnv)` is the pure detection rule over a `RuntimeEnv` snapshot.

`CliInteractive` is a `Context.Reference<boolean>`, read with `yield* CliInteractive` and never in `R`. It is `true` only for a **human** audience with a terminal on **both** stdin and stdout and a `TERM` that is not `dumb`: a dumb terminal cannot move the cursor, so it gets what a pipe gets. `CliInteractive.unless(condition)` switches prompting off for one subtree and can only narrow. `--human` recomputes it from the terminal facts, so a person running the tool inside an agent can ask for the human experience; a non-human flag turns it off and drops core's `--wizard`.

Not interactive, `CliEnv` replaces `Terminal` with a gated one: `readLine` fails as a quit, input is already ended, `display` writes nothing. **A program that reads piped data reads `Stdio.stdin`, never `Terminal`.**

## `CliEnv`

`CliEnv.layer(options?)` → `Layer<CurrentRuntimeEnv | TerminalEnv | Audience | CliTheme | CliLinks | Terminal, never, Stdio | Terminal>` builds the environment once, in order: the runtime snapshot, the terminal snapshot from the real terminal, the audience, the theme, editor links, then the `CliInteractive` decision and the two gates (`CliPrompt.gateTerminal`, `CliPrompt.gateWizard`) plus `CliTheme.promptTheme`, so core's own prompts follow the theme. Every environment read goes through `Config` and degrades to "unset" when it fails; only `Stdio` or `Terminal` failing fails the layer. Under `CliRuntime.main` pass the same options as `env` rather than providing the layer yourself. A test fixes the same services with `CliEnv.layerTest({ tty?, term?, audience?, columns?, color?, theme? })`, which reads nothing of the host's (see `testing-a-cli.md`).

| `CliEnvOptions` | What it does |
| --- | --- |
| `audienceEnvVar` | the variable that overrides the audience; an invalid value warns once and is ignored |
| `stderrIsTerminal` | `Effect<boolean>`; core's `Stdio` reports only stdout, so stderr mirrors it unless a host passes the real answer, e.g. `Effect.sync(() => process.stderr.isTTY === true)` in `main.ts` |
| `theme` | `{ tokens?, glyphs? }` for `CliTheme.layer` |
| `log` | `CliLogOptions` (optionally with `file`); `main` installs `CliLog.layer(log)` as the logger set and builds the platform under it. Only `main` reads it |
| `formatter` | methods of core's `CliOutput.Formatter` to replace in the coloured one `main` installs, e.g. `formatVersion`. Only `main` reads it |
| `displayPath`, `stackFrames` | how the default failure report shows a defect's frames: a path transform, and `"app"` (default: drop runtime and `node_modules` frames, count them) or `"all"` |
| `spans`, `spansEnvVar`, `appModule` | the `in: outer › inner` trail after a failure (an `Effect.fn` call and its definition are one entry): `"app"` (default: drop the spans the kit's `@effected/*` packages and Effect define, judged by each span's definition file under `node_modules`; fails open, so a linked or bundled kit shows more), `"all"`, or `"off"`. `FailureDetails.lines({ spans })` picks it per call. A bin installed under `node_modules/@effected/` passes `appModule: import.meta.url` to keep its own spans. `spansEnvVar: "TOOL_SPANS"` lets a user set it at run time, read exactly as `log.envVar` is (`spans` beats it; an invalid value warns once and is ignored) |
| `editorLinks`, `editorLinksEnvVar` | `"auto" \| "vscode" \| "file" \| "off"` for file links, and a variable that overrides it |

**`main` installs its formatter closer to the program than the platform**, so a formatter the platform sets is shadowed. Under `env`, customise it through `env.formatter`; never also wire `CliColor.formatterLayer` into the platform.

## Colour

Every colour decision is `@effected/env`'s `TerminalEnv`, read through `Config`, never `process`. It follows Node's `getColorDepth`, per stream:

1. **`FORCE_COLOR`, when set, decides alone** — and so **beats `NO_COLOR`**: `""`, `1` or `true` is basic colour, `2` is 256, `3` truecolor, anything else (`0` included) none. It forces colour on even without a terminal.
2. Otherwise a stream that is not a terminal has none.
3. Otherwise Node's terminal table: a non-empty `NO_COLOR` or `NODE_DISABLE_COLORS`, or `TERM=dumb`, is none (an empty `NO_COLOR=""` is not); then CI, `TERM_PROGRAM`, `COLORTERM` and `TERM` decide the depth. **A terminal with none of those set gets no colour.**

`ColorLevel` is `"none" | "basic" | "256" | "truecolor"`, per stream: `TerminalEnv.stdout.color` and `TerminalEnv.stderr.color`. `CliColor.enabled` (`Effect<boolean, never, Stdio>`) is the same decision for stdout as a plain boolean, and `CliColor.formatterLayer(overrides?)` builds core's formatter from it, for a program that does not use `env`. **An agent audience never receives an escape of any kind** — no colour, no hyperlink — whatever the colour level says, and even from an explicit `Render.ansi`.

A test fixes the environment with `Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ FORCE_COLOR: "0" }))` or fixes the answer outright with `TerminalEnv.layerTest({ stdout: { color: "none" } })`; never mutate `process.env`.

## Theme vocabulary: `Token`, `Status`, `Glyphs`, `CliTheme`

- **`Token`** — a `TokenName` (`success`, `failure`, `warning`, `info`, `error`, `muted`, `accent`, `emphasis`) or a custom `Style` built with `Token.hex`, `Token.named` or `Token.style`. Applying a token at colour `none` is the identity. `NamedColor` spells bright variants as chalk and Ink do (`redBright`, `blackBright`, `gray` as an alias).
- **`Status`** — an open vocabulary: `Status.core` (`success`, `failure`, `warning`, `info`, `skip`, `pending`) and `Status.extend({ name: { glyph, ascii, token, rank } })`. Names are typed, so a misspelt status is a compile error. `worst(names)` takes a non-empty list; `worstOption(names)` takes any list and returns an `Option`.
- **`Glyphs`** — `Glyphs.unicode` and `Glyphs.ascii` (status glyphs, bullet, arrow, ellipsis, spinner frames, tree segments, path separators). ASCII is chosen under `TERM=dumb` or by `theme: { glyphs: "ascii" }`.
- **`CliTheme`** — the service: `paint(token, text)`, `style`, `sgr`, `glyphs`, `color`, `status(vocab, name, text?)` for stdout, and `forStream("stderr")` for a `StreamTheme` painted with **stderr's** colour. Anything written to stderr is painted through `forStream("stderr")`. `CliTheme.layer(options?)` needs `TerminalEnv`; `CliTheme.layerTest({ color?, stderrColor?, glyphs? })` needs nothing.

## Messages: `CliMessage`

`CliMessage.success`, `info`, `warning`, `failure` and `status(vocab, name, text, { stream? })` each write **one themed line through `Console`, never the logger**, so no log level silences them. `success` and `info` go to stdout; `warning` and `failure` to stderr; `status` defaults to stderr for a rank at or above `warning`'s. Only the glyph is painted; an agent gets the glyph and plain text. They require `CliTheme | Audience`.

A status line that belongs on the **log channel** (filtered by the level, routed to stderr) is `CliLog.status(vocab, name, text, { level?, indent? })`: the logger sanitises every line a program logs, which would strip a glyph painted by hand, so the kit paints the glyph itself and keeps it, still sanitising `text`. The level follows the status's rank (`Error` from `failure`'s, `Warn` from `warning`'s, else `Info`); `indent` (spaces, or a sanitised string) goes before the glyph, for a line inside an indented report block. To paint lines of your own for an audience, apply the kit's rule with `CliTheme.forAudience(theme.forStream(stream), audience.kind)` (an agent gets the colourless theme) rather than re-implementing it.

Pick the channel by what the line is:

| Line | Write it with |
| --- | --- |
| the program's product (data, a `--format json` document, a rendered result) | `Console.log`, or `Doc.print` |
| a one-line outcome a person reads ("created 3 files") | `CliMessage` |
| a diagnostic an operator opts into (`--log-level`, `TOOL_LOG_LEVEL`) | `Effect.log*` through `CliLog` |
| a failure | fail; the report is `main`'s |

## Documents: `Doc`, `Render`, `Doc.print`

`Doc` is a document IR of plain frozen nodes, discriminated by `_tag`, built by constructors and rendered by pure functions. Build a report once; every audience gets the right bytes.

- **Inlines:** `Doc.text(value, token?)`, `code`, `link(target, label?, { suffix? })`, `status(vocab, name)`, `strong`, `em`, `file(path)`, `path(...segments)`.
- **Blocks:** `heading(level, content)`, `paragraph(...content)`, `line`, `lines`, `list(items, options?)`, `table(columns, rows, options?)`, `tree(root)`, `collapsible(title, body, { open? })`, `callout(kind, body)`, `codeBlock(text, lang?)`, `verbatim`, `diff(expected, received)`, `diffText(unified, { truncate? })`, `section(title, children)`, `counts({ counters, layout, ... })`, `countsTable(rows, options?)` (with `Doc.counter(vocab, name, { key, label, n })` for each cell; `label` may be `{ one, other }`: `one` for a count of exactly 1, `other` otherwise; a standalone count reads by its own `n`, and the share headline by the total, so `1/3 repos`), and `annotation(properties, message)`, which only the GitHub log renderer writes.

```ts
import { CliTheme, Doc, Render, Status } from "@effected/cli"
import { Audience, TerminalEnv } from "@effected/env"
import type { CliLinks } from "@effected/cli"
import type { Effect } from "effect"

const report = [
  Doc.heading(2, "Summary"),
  Doc.table(
    [{ header: "file" }, { header: "status", align: "right" }],
    [[Doc.file("/repo/package.json"), Doc.status(Status.core, "success")]],
  ),
]

// The effectful edge: picks the renderer from the audience and writes with Console.
export const print: Effect.Effect<void, never, CliTheme | TerminalEnv | Audience | CliLinks> = Doc.print(report)

// Pure, outside Effect: an agent's context is escape-free.
export const text: string = Render.plain(report, Render.contextOf({ audience: "agent" }))
```

**Top-level blocks are joined with no blank line between them**; only the children of a `section` are spaced (its title sits directly above the first child). To space a report's blocks, wrap them: `Doc.print([Doc.section(undefined, [a, b, c])])` (an `undefined` title is allowed). **`Doc.print` writes the document as one `Console.log`** (or `Console.error`), embedded newlines and all, so a captured stream holds one entry per document.

`Doc.print(doc, { stream?, format?, displayPath?, width? })` builds the context with `Render.context(stream)` and picks the renderer: `format: "auto"` is `plain` for an agent, `githubLog` for a CI that `CurrentRuntimeEnv` says is GitHub Actions (`plain` for any other CI), and `ansi` for a human; an explicit format wins. The renderers are `Render.plain` (agents: no escapes, `>` as the path separator, a link as its label plus the target in parentheses), `Render.ansi` (people: the same layout painted and linked), `Render.markdown` (GFM for step summaries and files; text is escaped so it cannot become markdown) and `Render.githubLog` (a top-level collapsible as a `::group::`). There is **no JSON renderer**: a machine format is the program's own schema, encoded and written with `Console.log`.

`Render.context(stream, { width?, displayPath? })` reads `CliTheme`, `TerminalEnv`, `Audience` and `CliLinks`. A human writing to a terminal gets `TerminalEnv.width()`; a human whose stream is not a terminal (`tool | grep`, `tool > out.txt`), an agent or a CI gets an **unbounded** width, so nothing a reader needs is cut or wrapped for a terminal that is not there. To keep one line whole even at a narrow terminal (a `path:line:col` finding that a reader greps), build it with `Doc.line(content, { wrap: false })`: unlike `Doc.verbatim`, it still carries a `Doc.status` glyph and theme tokens. `Render.contextOf(options)` is the same context as a pure value, for a renderer outside Effect.

**Every string that enters a document is sanitised**: escape sequences and control characters are removed, a tab becomes a space, and line breaks are kept as breaks (`Fmt.sanitize` is that function). Under GitHub Actions every format also **neutralizes workflow commands**, putting a zero-width space before a line the runner would read as `::command` or `##[command`, whoever the audience is. `Fmt` carries the other pure helpers: `width`, grapheme-safe `truncate`, `duration`, `percent`, `plural`.

`CliLinks` decides where a `Doc.file` link opens: `vscode://file/...` under the VS Code terminal or a project with `.vscode/`, `file://...`, or nothing. An OSC 8 hyperlink is written only when the terminal supports it **and** the audience is not an agent.

## The failure report

Under `CliRuntime.main`, an unhandled failure is drawn by `CliFailure.toDoc(cause, options)` and rendered for the run's audience on stderr, still through the logger. An error class can draw itself by implementing the `CliDoc` protocol (`[CliDoc]: () => Document`); otherwise a schema error becomes a tree of rejected values, `Cancelled` and `NotInteractive` print their fixed line, and a defect prints its message plus a collapsible stack of the program's own frames.

To customise it, pass `render(error, details)` to `main`. `details` is `{ cause, isDefect, defaultLines, lines }`: return `defaultLines` for the default report, `lines({ status: false })` for the default without its leading status glyph (to add a program-name prefix), or your own lines. `isDefect` is `!Cause.hasFails(cause)`; never infer "typed" from an `Error` with a string `_tag`, which a defect can carry too. `CliRuntime.defaultRender(error, details)` hands a failure you do not own back to the kit. A `render`'s own lines are text the kit did not build: it sanitises the data it interpolates.

## Diagnostics: `CliLog`

`CliLog.layer(options?)` **owns the whole logger set**: it installs the plain `CliLogger` for ordinary lines plus a diagnostics sink on stderr, and replaces whatever was installed without reading it. Use it instead of `CliLogger.layer`, never on top of it, and never install your own `Logger.layer([...])` beside it: that silently replaces the set, and the diagnostics go quiet with no error. Under `CliRuntime.main`, pass the options as `env.log`.

- **Level:** `CliLog.Level` is a reference defaulting to `None`, filtered on its own threshold. `level` beats `envVar` (e.g. `"TOOL_LOG_LEVEL"`, read through `Config`); core's `--log-level` beats both while set. An invalid value warns once and never fails the run.
- **Format:** `"auto"` (the default) decides **by audience alone**: NDJSON for an agent or a CI, a pretty line for a human. Stderr's terminal state never decides the format. `"json"` and `"pretty"` fix it. The requirements follow the format: `json` needs nothing, `pretty` needs `TerminalEnv`, `auto` needs `Audience | TerminalEnv`.
- **NDJSON:** each line is core's `Logger.formatJson`. Stderr is not pure NDJSON while diagnostics are on, so a parser reads the lines that start with `{`.
- **`component(name)`** annotates a line: `Effect.logInfo("wrote").pipe(CliLog.component("init"))`.
- **`file: { envVar } | { path }`** adds an async NDJSON file sink; the layer then requires `FileSystem | Path`. It reports its first write error once and then drops lines, and waits at most two seconds for its drain on exit.
- **`plainLogger: false`** is the diagnostics-only mode for a library host (an MCP server, a test reporter).
- **`extraLoggers`** keeps loggers you own, such as telemetry, inside the set.
