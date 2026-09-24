# Output and logging: the `@effected/cli` boundary

Loaded from `effect-v4-cli`. Covers the three defaults core gets wrong at a terminal, why `@effected/cli` exists to fix them, and the implementation facts behind `CliLogger` and exit-code reporting.

## The boundary core does not give you — reach for `@effected/cli`

`effect/unstable/cli` owns parsing, flags, the command tree and help. It owns
**nothing** about how output reaches a person, and the three defaults you get
are all wrong at a terminal. Each is invisible from the code and only shows up
when a user looks at the output:

1. **Effect's default logger emits `[00:33:56.619] INFO (#2): message`** — right
   for a scraped service, wrong for a tool someone is watching. It will destroy
   any formatted table you print.
2. **An unhandled failure is reported by `runMain` through the DEFAULT logger,
   on stdout** — outside the layers your program installed. So a program that
   carefully installs a CLI logger still prints its failures in the shape that
   logger exists to replace, on the one stream errors must not use
   (`mytool run > log.txt` must still show failures on the terminal).
3. **A `SchemaIssue` tree is not a sentence.** Core *does* ship formatters —
   `SchemaIssue.makeFormatterStandardSchemaV1` — but they live in `SchemaIssue`
   rather than `Schema` or `SchemaError`, are named `makeFormatter*` rather than
   anything containing "render", and `SchemaError.message` does not use them, so
   the obvious probe hints at nothing. Two engineers searched for two rounds and
   concluded they did not exist.

**`@effected/cli` is the boundary for all three** — `CliLogger`, `CliRuntime`
and the schema/config issue renderers. It is deliberately not a second
framework: parsing stays core's.

Implementation facts worth knowing even if you write your own:

- **A logger cannot write through `Stdio`'s sinks.** `Logger.make` takes a
  *synchronous* callback and a `Sink` write is an `Effect`. The path that works
  is the one core's own `defaultLogger` takes: read the **`Console` reference off
  the fiber** (`Console.Console` is a public `Context.Reference` with a default,
  so nothing enters `R`), then `console.error` vs `console.log` by level. It is
  also the only design that is *testable* — a `process.stdout` write cannot be
  asserted without stubbing globals, which is why nobody notices when the
  stderr/stdout split regresses. **Compare levels ordinally**
  (`LogLevel.isGreaterThanOrEqualTo`), never by string equality against `"Error"`.
- **`CliLogger.layer()` sends every log level to stderr, by default.**
  `stderrFrom` defaults to `"All"` (`CliLogger.make`: `options.stderrFrom ??
  "All"`), so stdout carries only what the program writes with `Console.log` —
  a `--format=json` document stays clean of warnings. Write program output with
  `Console.log`, never `Effect.log`: every `Effect.log*` call is a diagnostic.
  Pass `CliLogger.layer({ stderrFrom: "Error" })` for the alternative split,
  where `Info`/`Warning` go to stdout as program output — right only for a tool
  whose output *is* its log lines.
- **`Command.runWith` renders a `CliError.UserError` itself** — through the
  `CliOutput` formatter, on stderr — then re-fails with it, so
  `CliRuntime.reportFailures` and `CliRuntime.main` skip it (and exit with the
  usage code, `64` by default) rather than printing it a second time. A
  `CliError.UserError` marked at the throw site with `CliRuntime.reported`
  (never printed by `Command.runWith` at all) is skipped by the same check —
  `reportFailures` only tests the tag and the mark, so it cannot tell one a
  handler reported itself from one `Command.runWith` already printed.
- **Exit code and duplicate-report suppression are markers on the error**, read
  off the squashed failure: `Runtime.errorExitCode` and `Runtime.errorReported`.
  Beware the polarity — **`errorReported: false` is what SUPPRESSES** the
  runtime's own log ("already reported"); omitted or non-boolean is treated as
  `true` and it logs. The intuitive `true` produces exactly the double report
  you were trying to avoid.

`reportFailures` never renders a `ShowHelp`, the `CliExit` findings sentinel,
or a `CliError.UserError` marked with `reported: false` — but it still
renders any OTHER error whose `errorReported` mark is `false`, such as a
domain error `CliRuntime.reported` marked at the throw site: the mark means
"don't report this the way the runtime normally would," not "never render
it here." Only those three tag/mark combinations are skipped outright.

## The stdout/stderr split and message conventions

**Stdout carries only what the program writes with `Console.log`** — data,
envelopes, rendered results, help text. **Everything else goes to stderr**:
every `Effect.log*` call, warnings, summaries and every reported failure
(`CliLogger`'s default `stderrFrom` is `"All"`). A `--format json` consumer
piping only stdout therefore never has to filter a stray log line out of its
document.

Message conventions, so different commands read as one program: lowercase
the message, prefix with `error:` or `warning:`, no trailing period, and
render paths relative to the current working directory rather than absolute.

## Colour: `CliColor`

**`CliColor.enabled`** is the no-color.org decision, `Effect<boolean, never,
Stdio>`: colour is on only when stdout is a terminal *and* `NO_COLOR` is not
set to a non-empty value. It reads `NO_COLOR` through the ambient `Config`
(never `process.env` directly), so a test swaps the provider instead of
mutating a global — `FORCE_COLOR` is ignored, matching core's own formatter.

~~~ts
import { CliColor } from "@effected/cli"
import { ConfigProvider, Effect, Stdio } from "effect"

const program = CliColor.enabled.pipe(
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ NO_COLOR: "1" }))),
  Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(true) })),
)

Effect.runPromise(program).then((enabled) => {
  console.log(enabled)
})
~~~

This prints `false`: stdout is a (faked) terminal, but a non-empty `NO_COLOR`
still wins.

**`CliColor.formatterLayer(overrides?)`** builds core's own
`CliOutput.Formatter` from that same decision, so help text, parse errors and
any rendered output agree on whether colour is on — never wire a formatter by
hand next to `CliColor.enabled`, or the two can disagree.
