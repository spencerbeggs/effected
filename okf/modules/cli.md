---
type: Module
title: "@effected/cli"
description: The presentation boundary of an effect/cli program — audience, colour, theme, messages, logging, failure reporting and schema-issue renderers in a React-free root, with interactive screens planned behind ./ui.
status: stable
kind: package
resource: ../../packages/cli
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T01:17:10Z
  body_sha256: 50440cae481c6279f27afe2038c6ff085e7814cfa317c2b9b871ced642ff74fd
---

# @effected/cli

`@effected/cli` is the presentation boundary of a command-line program built
on `effect/cli`: who the output is for, how it reaches them, how a failure is
reported, and how a schema issue is rendered into a sentence a user can act
on. The [presentation layer](../decisions/cli-grows-presentation-layer.md)
— audience, interactivity, theme, a status vocabulary, messages and logging
composition — lives in a React-free root; interactive screens are planned
behind a `./ui` subpath the root never reaches. It is still not a CLI
framework: `effect/cli` owns argument parsing, flags, the command tree and the
help system, and this package must never grow a second one.

The distinguishing property of everything in scope: a consumer only
discovers the need by shipping bad output to a person. None of it fails a
type-check, a test, or a review of the code in isolation — the default
behaviour is wrong in a way the author cannot see from the call site.

## Motivation: three defaults that are wrong at a terminal

Each of these is found by running a binary, never by reading the code.

1. **Effect's default logger is a service log line, not CLI output.** It
   emits `[00:33:56.619] INFO (#2): message` — correct for a long-running
   service being scraped, wrong for a tool a person is watching. Every
   `effect/cli` program needs a logger that renders the message
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
runtime dependency (`string-width` is a test-only `devDependency`; see
[the display-width decision](../decisions/own-display-width.md)), and must not
import a platform package. `@effected/env` is a required peer, so the audience
and terminal decisions are made once and read as services
([its own package](../decisions/env-is-its-own-package.md)); `ink` and `react`
are never imported from the root. This is the
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
| `MainOptions<RP, EP>` | `ReportFailuresOptions & { platform: Layer<RP, EP>; logger?: Layer<never> }` — `platform` is passed in rather than owned so this package never imports one; `logger` defaults to `CliLogger.layer()`. |
| `CliExit` | A `Context.Service` holding a `MutableRef<number>`; `CliExit.set(code)` and `CliExit.layer` for in-process tests. **`CliExit.layer` is `Layer.fresh`** — every provide mints a new cell, so a program run under `CliRuntime.main` must not provide `CliExit.layer` itself, or `CliExit.set` writes to a second, unread cell and the run silently exits `0`. See "Findings are success" below. |
| `CliColor.enabled` | `Effect<boolean, never, Stdio>` — `TerminalEnv.colorLevel("stdout") !== "none"`, so it honours `FORCE_COLOR` with Node's precedence ([D-C](../decisions/force-color-honoured-node-precedence.md)). Reads go through `Config`, never `process`. |
| `CliColor.formatterLayer` | `(overrides?: Partial<CliOutput.Formatter>) => Layer<never, never, Stdio>` — builds `CliOutput.defaultFormatter({ colors })` from the same `CliColor.enabled` decision, so help text, parse errors and rendered output always agree. |
| `MainOptions.helpOnUsageError` | `"stdout" \| "stderr"`, default `"stdout"` (core's behaviour). Under `"stderr"`, `main` wraps `program` (inside the platform provide, so it sees the platform's Formatter) with `internal/HelpRouting.ts`: a recording `CliOutput.Formatter` notes the strings `formatHelpDoc`/`formatErrors` return, and a routing `Console` holds a `log` of a recorded help string until the next console call. If that call is `error` of a recorded errors string, the help goes to stderr ahead of it; anything else, or the program ending (`ensuring`), releases it to stdout. Needed because core prints help with the same `Console.log` for `--help`, a bare group invocation (a `ShowHelp` with no errors) and a usage error, and only the usage error prints `Console.error(formatErrors)` next (`cli/Command.ts` `showHelp`). Caveats: a Formatter or Console provided inside `program` bypasses it, and `renderErrors: false` prints no errors, so help stays on stdout. |
| `ReportFailuresOptions.render` | `(error: unknown, details: FailureDetails) => string \| ReadonlyArray<string>`. `error` is `Cause.squash(cause)`; `FailureDetails` is `{ cause, isDefect }`, with `isDefect = !Cause.hasFails(cause)` — exact because `squash` prefers a `Fail` over a `Die`. Added so a consumer stops guessing "typed" from an `Error` carrying a string `_tag`, which a defect can also be. A one-parameter renderer still fits. If that rendering dies, the report falls back to the plain path and then to the error's own text, sanitised and neutralized. The default is `CliFailure.toDoc` rendered through `Render.context("stderr")` and the audience-chosen renderer, still written through `CliLogger` (so `--log-level` and the logger options are unchanged). `reportFailures` catches outside the layers `main` provides, so `main` gives it a per-run cell the environment layer fills with the render target, and `CliAudience.runWith` rewrites it once an audience flag is read. `CliRuntime.defaultRender(error, details)` is the same document as plain lines, exported so a consumer `render` hands the failures it does not own back (`Cancelled` and `NotInteractive` are their own fixed line). |
| `ReportFailuresOptions.usageExitCode` | Remaps a `ShowHelp` that carries errors to this code, default 64 (D7). A `ShowHelp` with no errors keeps exit 0. |
| `SchemaIssueRenderer` | `SchemaIssue` tree → actionable lines, over core's formatter |
| `ConfigIssueRenderer` | The same for `@effected/config-file`'s `ConfigValidationError` |

### The presentation layer

Exports the interactive CLI kit adds to the root. Rows marked planned are
later phases and not yet exported. See
[the presentation-layer decision](../decisions/cli-grows-presentation-layer.md)
for why the package owns them.

| Export | Contract |
| --- | --- |
| `CliEnv.layer` | `(options?: CliEnvOptions) => Layer<CurrentRuntimeEnv \| TerminalEnv \| Audience \| CliTheme, never, Stdio \| Terminal>` — builds the environment services once, in the right order, **sets** the `CliInteractive` reference from the audience and terminal, and installs `CliPrompt.gateTerminal`, `gateWizard` and `CliTheme.promptTheme` (core's prompts follow the theme), so the layer also outputs the gated `Terminal`, which `CliEnvServices` lists. Not interactive, that terminal's `readLine` fails as a quit and its `display` writes nothing. A reference's key type is `never`, so `CliInteractive` is not in the output type. Every read degrades to unset when `Config` fails, so only `Stdio` or `Terminal` failing fails the layer. `CliEnvOptions` is `{ audienceEnvVar?, stderrIsTerminal?, theme?, log?, editorLinks?, editorLinksEnvVar? }`; `log` is read only by `CliRuntime.main`. |
| `MainOptions.env` | `CliEnvOptions`. When present, `CliRuntime.main` builds `CliEnv.layer(env)` inside failure reporting, where the platform sits, together with `CliColor.formatterLayer` so help text follows the same colour decision, so a failure building it renders one line and exits through the `exitCode` option rather than reaching the runtime's stack trace. `env.displayPath` is the path display (workspace-relative, say) for the default report's stack frames. `env.formatter` replaces methods of the coloured `CliOutput.Formatter` `main` installs (for example `formatVersion`). With `env.log`, `main` builds the platform UNDER the logger, so a line it logs while building goes to stderr, and uses `CliLog.layer(env.log)` as the logger set (`env.log` may carry the `file` option when the platform provides `FileSystem` and `Path`) instead of the default `CliLogger.layer()` (an explicit `logger` option still wins); the logger is built over the same env layer and falls back to `CliLogger` if that build fails. Not interactive, the program's `Terminal` is gated: `readLine` fails as a quit, so a program reading piped data must read `Stdio.stdin`. Without `env`, nothing is provided and `CliInteractive` keeps its non-interactive default, so forgetting it yields a CLI that never prompts. |
| `CliAudience.flags` | `(options?: { hidden? }) =>` the four shared flags `audience`, `human`, `agent`, `ci`, each `Flag.atLeast(0)`; spread into `Command.withSharedFlags` on the root. `hidden` applies `Flag.withHidden`. `--audience` carries a metavar naming its three values in angle brackets, spelled as core spells its own, instead of core's generic `choice`. Core lists shared flags in every subcommand's help, which is upstream (Effect-TS/effect issue 8642). |
| `CliAudience.provide` | Piped onto the composite root (after `withSubcommands`): resolves the flags with `Command.provideEffect` and re-provides env's `Audience` with `source: "flag"`. More than one occurrence is a `CliError.UserError`, exit 64. `run` and `runWith` apply it themselves, so it is the path for a bare `Command.run` only; it then covers the subcommand handler (with the same interactivity decision) but not a fallback prompt. See [the audience flag decision](../decisions/audience-flag-is-shared-root-flags.md). |
| `CliAudience.runWith`, `CliAudience.run` | THE wiring for the audience flag: `Command.make(...).pipe(Command.withSharedFlags(CliAudience.flags()), Command.withSubcommands([...]))`, then `CliRuntime.main(CliAudience.run(root, { version }), { platform, env })`. `runWith(root, config)(argv)` and `run(root, config)` (reads `Stdio.args` like `Command.run`) scan argv for the four flags BEFORE core parses, apply `provide` themselves, and run core inside a provided `Audience` (`{ kind, source: "flag" }` for exactly one flag) and a `CliInteractive` the flag decides from the audience and the TTY facts (`--human` is interactive when `TerminalEnv` reports a terminal on stdin and stdout, even under a detected agent, and never in a pipe; a non-human flag or a conflict makes it false; with no `TerminalEnv` a flag only narrows), with `--wizard` following that decision (restored only where `gateWizard` dropped it, which it records) and diagnostics switched to NDJSON for a non-human flag. A root without the shared flags does not compile (`RequiresAudienceFlags`). The scan and the resolver share one counting rule (true occurrences only). |
| `CliInteractive` | A `Context.Reference<boolean>` defaulting to `false`, read with `yield* CliInteractive` and never in `R`: `Audience` is `human`, stdin is a terminal and stdout is a terminal. Static `layer` (from `Audience` and `TerminalEnv`), `layerTest(value)` and `unless(condition)`, a scoped override that can only turn it off. Both layers are typed `Layer<never>` because they set the reference. |
| `Token`, `Style`, `TokenName` | A token is a style; applying it is identity when colour is `none`. `TokenName` is `success`, `failure`, `warning`, `info`, `error`, `muted`, `accent` or `emphasis`. `Token.hex`, `Token.named` and `Token.style` build custom styles. `Token.defaults` is the frozen default style of every token and `Token.resolve(token, overrides?)` the pure resolution `CliTheme.paint` applies (a name that is not a token resolves to the empty style), so a renderer with no Effect context reads styles as data. `NamedColor`'s bright variants are spelled as chalk and Ink spell them (`redBright`, `blackBright`, with `gray` as an alias); the `Style` to Ink props mapping ships in `./ui` in P4 and P5. A colour name that is not a `NamedColor` paints nothing. |
| `Status` | An open vocabulary: `Status.core` (`success`, `failure`, `warning`, `info`, `skip`, `pending`) and `Status.extend(extra)`, each entry a glyph, an ASCII glyph, a token and a rank. `resolve(name)` returns the full definition as a frozen copy, which the document IR stores, and, like `def`, throws on a name the vocabulary lacks (reachable only through a cast). `worst(names)` takes a non-empty list and returns the highest rank, ties to the first (rank is severity, not an aggregation policy: a consumer whose rule differs folds its own); `worstOption(names)` takes any array and returns an `Option`, `None` when empty. Names are typed, so a misspelt one is a compile error. |
| `Glyphs` | `Glyphs.unicode` and `Glyphs.ascii`: the status glyphs, bullet, arrow, ellipsis, spinner frames, `spinnerIntervalMs` (80), `tree` segments (`branch`, `last`, `pipe`, `blank`: box-drawing in Unicode, `-`, `\` and pipe characters in ASCII) and `pathSeparator` (`human`, `agent`: `›` and ` > `, or `>` and ` > ` in ASCII). ASCII is chosen under `TERM=dumb` or by option. `Glyphs.select({ ascii?, term? })` is that choice as a pure function (`auto` is ASCII only for `term` `dumb`, passed in because `StreamEnv` carries no `TERM`), which `CliTheme.layer` calls after reading `TERM` through `Config`. |
| `CliTheme` | A `Context.Service` with `paint`, `style` (the resolved style `paint` renders, whatever the colour level), `sgr`, `glyphs`, `color` and `status` (the stdout ones) and `forStream("stdout" \| "stderr")`, a `StreamTheme` painting with THAT stream's colour from `TerminalEnv.stderr.color` or `.stdout.color`; anything written to stderr is painted through `forStream("stderr")`, as `CliMessage` does. `layer({ tokens?, glyphs? })` needs `TerminalEnv`; `layerTest` fixes the colour level; `promptTheme` sets core's `Prompt.Theme` from the tokens, with empty colour strings when colour is `none`. |
| `Fmt` | `width`, `truncate` (grapheme-safe, ANSI-safe, result never wider than asked), `duration` (`250ms`, `1.2s`, `1m 3s`, `1h 2m`), `percent` (a 0 to 1 ratio, or a 0 to 100 number with `{ scale: 100 }`) and `plural`. Width comes from [the package's own implementation](../decisions/own-display-width.md). |
| `CliMessage` | `success`, `info`, `warning`, `failure` and `status(vocab, name, text)`: one themed line each through `Console`, never the logger, so no log level silences them. `warning` and `failure` go to stderr; the others to stdout, and `status` defaults to stderr for a rank at or above `warning`'s. Only the glyph is painted and the text stays plain; an `agent` audience gets the glyph and text, never colour, even when the theme has colour. A `ci` audience is themed like a human, with colour still gated by `TerminalEnv`. Empty text prints the glyph alone. Every kit path that writes consumer-supplied text — `Doc.print`, `CliMessage`, the failure report — sanitises it and neutralizes it under GitHub Actions; the diagnostics loggers join in the `@effected/github-commands` addendum. |
| `CliLog` | Diagnostics, kept apart from `CliMessage`. `Level` is a reference defaulting to `None`, filtered on its own threshold rather than `MinimumLogLevel`. `layer({ level?, envVar?, format?, plainLogger?, logger?, extraLoggers? })` **owns the whole logger set** (`extraLoggers`, for example a telemetry logger, are kept and floored like the `CliLogger`): it builds the `CliLogger` (floored at the minimum level it had) and the stderr sink, NDJSON or pretty, and replaces whatever was installed without reading it, so there is no order to get wrong; use it instead of `CliLogger.layer`, never on top of it, and a platform that installs its own `Logger.layer([...])` replaces it silently. `level` beats `envVar` and loses to core's `--log-level`; `plainLogger: false` is the diagnostics-only mode (no plain `CliLogger`, so no level means no stderr). The requirements follow a fixed `format`: `json` needs neither `Audience` nor `TerminalEnv`, `pretty` needs `TerminalEnv`, `auto` needs both. The NDJSON line is core's `Logger.formatJson`, whose `message` is a string for one argument and an array for several. Stderr is not pure NDJSON while diagnostics are on, so a parser reads the lines that start with `{`. `component(name)` annotates a line. The `file: { envVar } \| { path }` option adds an async NDJSON file sink (a queue drained by a scoped fiber, the same NDJSON line as the stderr sink in json format) that reports its first write error once (a defect counts too) and then drops further lines, and closing the scope waits at most two seconds for the drain so a hung filesystem cannot hang exit; only a layer given `file` requires `FileSystem` and `Path`. |
| `Cancelled` | A tagged error, `reason: "escape" \| "interrupt"`, carrying exit code 130 through the runtime-marker mechanism. Its `message` is the fixed line `cancelled; nothing written` (a prototype getter, not part of the encoded form), so a consumer `render` can print `error.message`; `NotInteractive` does the same with `not interactive: run in a terminal or pass the flag`. See [one Cancelled for two engines](../decisions/one-cancelled-for-two-prompt-engines.md). |
| `NotInteractive` | A tagged error for a prompt reached in a non-interactive run; exits 64. |
| `CliPrompt.fallback` | `(prompt, { flag \| argument, otherwise? }) => Param.FallbackPrompt` — prompts only when `CliInteractive` is true, else returns `otherwise` (`undefined` counts as not given), else fails as a missing flag or argument built from the given name (exit 64). The prompt runs inside the fallback so a quit becomes `Cancelled` (exit 130) instead of core's missing-flag error; `Cancelled` travels as a defect, so a handler's `catchTag` cannot see it and only `CliRuntime.main` renders it as one line. |
| `CliPrompt.gateTerminal` | `Layer<Terminal, never, Terminal>`, deciding on EVERY call from the current `CliInteractive`, not at build, so a later narrowing (an audience flag under `CliAudience.runWith`) reaches it. Not interactive, it behaves as a quiet `Terminal` (input an already-ended queue, `readLine` a quit, `display` a no-op) that delegates `columns` and `rows` to the real one; interactive, the real terminal passes through. It exists because core runs `Prompt.run` even on an answered fallback, and on the real Node terminal subscribing the input attaches a readline to stdin, dropping piped bytes and putting a TTY into raw mode. `CliEnv.layer` installs it (and `gateWizard`) after `TerminalEnv` is built from the real terminal, so consumers never compose it. |
| `CliPrompt.gateWizard` | A layer that drops core's `--wizard` built-in from the run when it is not interactive. |
| `Doc` | The document IR, plain frozen nodes discriminated by `_tag` and built by constructors (`Doc.text`, `code`, `link`, `status`, `path`, `heading`, `paragraph`, `list`, `table`, `tree`, `collapsible`, `callout`, `codeBlock`, `diff`, `section`, `counts`), and `Doc.print(doc, { stream?, format?, displayPath?, width? })`, the effectful edge: it builds the context with `Render.context`, picks the renderer (`auto`: `plain` for an agent, `githubLog` for a CI that an optional `CurrentRuntimeEnv` says is GitHub Actions and `plain` for any other, `ansi` for a human; an explicit format wins) and writes with `Console.log` or `Console.error`; a document that renders to nothing prints nothing. A status node stores a `Status.resolve` definition. See [the IR decision](../decisions/doc-ir-is-plain-data.md). |
| `Render` | Pure `plain`, `ansi`, `markdown` and `githubLog` renderers over a `RenderContext`, and `Render.context(stream, { width?, displayPath? })` to build one from `CliTheme`, `TerminalEnv`, `Audience` and `CliLinks`: the audience in force, THAT stream's colour and hyperlink support, `CliLinks.linker` as `link`, and for an agent colour `none` with an identity `paint` (an agent never gets an escape of any kind, so even an explicit `ansi` is escape-free for it), and a width that is `TerminalEnv.width()` for a human and unbounded (`Infinity`) for an agent or a CI, so nothing a reader needs is cut for a terminal that is not there; an explicit width wins. The context also carries `neutralizeWorkflowCommands`, set whenever an optional `CurrentRuntimeEnv` says GitHub Actions, for every audience: the runner reads a line that starts with `::` or `##` as a command, so every renderer then puts a zero-width space in front of such a line (the one `neutralizeLines` that `githubLog` uses, which is idempotent, so it is never doubled). The failure report without any environment services always sets it. `Render.ansi` (for people) is built on the same walk as `Render.plain`: the same layout painted with the context's tokens and linked through `ctx.link`, and identical to plain at colour none apart from code markers and the path separator. `Render.githubLog` is plain text with a top-level collapsible as a `::group::`, nested collapsibles flattened, and any line a runner would read as a command neutralized. The runner has TWO parsers (`actions/runner`, `ActionCommand.cs`): V2 trims .NET whitespace then looks for `::` at the start, and the legacy one finds `##[` ANYWHERE in the line (a bare `##` is no command), so neutralizing puts a zero-width space before such a `::` and inside every `##[`; a markdown heading is untouched, and under Actions a zero-width space can land inside code or table text where it would otherwise have formed a command. That neutralizing is not `githubLog`'s alone: every format does it, through the same function, whenever the context says the runner is GitHub Actions (`neutralizeWorkflowCommands`, set by `Render.context`), whoever the audience is; `githubLog` always does. `Render.markdown` (GFM, for step summaries and files) is built and verified against `@effected/markdown` as a test-only oracle: text is escaped so it cannot become markdown, and links are only emitted for a safe scheme. `Render.plain` (for agents) is built: no escape of any kind, a path joined with `>`, a link as its label plus the target in parentheses, a long URL kept whole. No JSON renderer ([decision](../decisions/no-json-renderer.md)). |
| `GithubAnnotation` | `format(annotation, message)` for a GitHub workflow-command annotation: the message escapes `%`, CR and LF, a property also `:` and `,`, written in the order `WorkflowCommand` uses, which the test-only oracle `@effected/github-actions` confirms. |
| `CliLinks` | Where a file link opens: `vscode://file/<path>:<line>:<col>`, `file://<path>` or none. `auto` is `vscode` on the `vscode` terminal signal or a `.vscode/` directory at the project root (the nearest ancestor with `.git` or `pnpm-workspace.yaml`, found with `Walker.ascend`, at most 64 directories up, and `Walker.findRoot`: [decision](../decisions/cli-takes-the-walker-edge.md)); an environment variable the consumer names beats the option. `CliLinks.linker({ links, hyperlinks, audience })` is the `RenderContext.link` policy: OSC 8 only when hyperlinks are on and the audience is not an agent. `CliEnv.layer` provides it and takes `FileSystem` and `Path` from the environment when it has them, without requiring them. One link-scheme allow-list (`internal/linkScheme.ts`: `http`, `https`, `mailto`, `file`, `vscode`, `vscode-insiders` or a relative URL) serves the OSC 8 linker and `Render.markdown`, and one path-to-URL builder (`internal/linkTarget.ts`) serves both, so a file links the same way in each: a Windows drive path (`C:\x\y.ts`, `C:/x`) is absolute on any `Path` flavour and keeps its drive (`file:///C:/x/y.ts`); a colon anywhere else in a POSIX path is data and stays encoded (the one false positive is a relative `a:/b.txt`, read as drive `a`); a UNC path (`\\server\share`, `//server/share`) has no link target. The linker percent-encodes every character outside printable ASCII in a `{ url }` target without touching what is already encoded, and a bad `editorLinksEnvVar` value warns once and falls back to the option. |
| `CliFailure`, `CliDoc` | `CliFailure.toDoc(cause, { render?, displayPath? })` is a failure as a `Document`, one run of blocks per `Cause` reason: an error that implements the `CliDoc` protocol draws itself, else the per-`_tag` `render` map, else `Cancelled` and `NotInteractive` as their fixed line, else a `Tree` of a schema error's rejected values (nested by path), else a failure status line. A defect is its message, a collapsible `stack` of the program's own frames as file links (`node:internal` and Effect frames hidden; `no user frames (N internal frames hidden)` when none are left), and an `Error.cause` chain as a tree. A reason that ran under spans is followed by `in: outer › inner`, read from the `Cause.StackTrace` annotation chain (innermost first). An interrupt-only cause is `interrupted`. The two issue renderers read the same rejected values, so `SchemaIssueRenderer.render` and `ConfigIssueRenderer.render` return exactly the lines they always did. |
| `./ui`, `./ui/testing` | Planned (P4): interactive Ink screens, widgets and a live view, behind optional peers the root never reaches. |

### `@effected/cli/testing` (new subpath)

| Export | Contract |
| --- | --- |
| `CliTest.sandbox` | `Effect<Sandbox, PlatformError, FileSystem \| Path \| Scope>`. A temporary directory with a fresh `HOME` and `XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, and `NO_COLOR=1`. `PATH` is taken from an injected value and never inherited through `extendEnv`. |
| `TestTerminal.make` | `(options?: { columns? }) =>` an `Effect` of a `Terminal` layer with `input(keys)`, `type(text)`, `end` and captured `output`. Core's own mock terminal is test-only and unexported; this one drives core `Prompt` and `CliPrompt.fallback` in tests. |
| `CliTest.run` | `(bin, args, { sandbox, execPath, cwd?, env?, stdin? }) => Effect<{ exitCode; stdout; stderr }, PlatformError, ChildProcessSpawner>`. Two deliberate differences from spec §6: there is **no `path?` option** (`PATH` is fixed once by `CliTest.sandbox({ path })`, and a per-run override goes through `env`, which merges over the sandbox environment), and it **scopes itself** (`Effect.scoped` around the spawn), so `Scope` is not in `R` and a caller need not wrap each run. A non-zero exit is data, not a failure. Spawns `execPath` with `[bin, ...args]` over core `ChildProcess` (D9), no peer on `@effected/commands`. **When `stdin` is omitted OR passed as `""`, the spawned child receives an already-ended empty input, never an open pipe** — a test that does not pass `stdin` never hangs waiting for one. |

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
a `ShowHelp` reaches `reportFailures` (the `ShowHelp` `catchFilter` in
`runWith`: `Command.ts:1996-2001` in the vendored `.repos/effect` tree) — rendering
it a second time is what produced the stray "Help requested" line every
consumer previously worked around by hand. `reportFailures` now never
renders a `ShowHelp`, and never renders the `CliExit` sentinel either.
Nor does it render a `CliError.UserError` `runWith` already printed
(`showUserError` flips its `Runtime.errorReported` mark to `false` after
printing); that one exits with `usageExitCode`. Under `renderErrors: false`
the mark stays `true` and the error renders normally. It
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

The presentation layer adds its own:

- [`@effected/cli` grows a presentation layer](../decisions/cli-grows-presentation-layer.md)
- [two prompt engines raise one `Cancelled`](../decisions/one-cancelled-for-two-prompt-engines.md)
- [the audience flag is four shared root flags](../decisions/audience-flag-is-shared-root-flags.md)
- [the package owns its display width](../decisions/own-display-width.md)
- [the document IR is plain data](../decisions/doc-ir-is-plain-data.md),
  [it has no JSON renderer](../decisions/no-json-renderer.md) and
  [`CliLinks` finds the project root with `@effected/walker`](../decisions/cli-takes-the-walker-edge.md),
  which supersedes the draft that had it [inline](../decisions/cli-links-inline-ascent.md)
  (all drafts, built in P3, awaiting a human to verify them)
- [`FORCE_COLOR` is honoured](../decisions/force-color-honoured-node-precedence.md)
  and [`@effected/env` is its own package](../decisions/env-is-its-own-package.md),
  both recorded against the [`env` Module](env.md)

## Errors

**Two error classes, both about prompts:** `Cancelled` and `NotInteractive`.
Everything else here is presentation: it renders errors other packages raise
and must not wrap them. A renderer that fails has a defect, not a domain error
— a `SchemaIssue` tree that cannot be rendered is a bug in the renderer.

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

Out of scope, and staying out: argument parsing, flags, the command tree and
help (`effect/cli` owns them), a platform package, and a dependency edge from
anything but an application. Prompts and interactive UI used to be on this
list; [the presentation-layer decision](../decisions/cli-grows-presentation-layer.md)
moved them in, and the old boundary limitation is deprecated.

## Build

Standard package setup. Expected to need no API Extractor suppression: no
class factories here, so no synthesized `_base` symbol. Gate on a cold
`pnpm build --filter @effected/cli`, never the raw script.
