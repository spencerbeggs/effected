# The log sink and the logging contract

## One `Logger` renders every `Effect.log*`

`ActionLogger.logger`, installed via `ActionLogger.layerLogger`, maps every
log entry onto a workflow command by level:

| Effect log level | Rendered as |
| --- | --- |
| `Error`, `Fatal` | `::error::` (with any source annotation) |
| `Warn` | `::warning::` (with any source annotation) |
| `Info` | plain text — no command, no annotation |
| `Debug`, `Trace` | `::debug::` |

`Info` is deliberately plain text: prefixing it would turn every
informational line into an annotation in the workflow summary. There is no
ANSI/colour API, and none exists to invent — the rendering layer emits
nothing but the `::name key=value::message` text; GitHub's own log viewer
colours the commands, not this package.

## The shape of a kit action's log

Two levels, built on what the GitHub log can do: it is append only (no
spinners, no rewriting), `::group::` folds its body but cannot be opened
automatically, groups do not nest, and a folded failure is a hidden failure.

- **A phase** is a plain bold heading, never folded (`Checkout owner/name @ main`,
  `Runtime Setup`). It writes nothing when it ends.
- **A step** is the unit with a quiet window and a result line. Its detail
  (every log line below `Warn`, plus the output of commands run through
  `ActionLogger.command`) is held back while it runs.

A step's life:

1. **It finishes inside its window:** one folded group titled by the outcome
   (`✓`, `⚠` or `✗`), a summary and the duration, with the held detail inside.
   A step with no detail is a plain result line.
2. **It runs past its window:** a line `… <name> is taking longer than <window>,
   showing live output`, then everything held so far, then the detail streams
   live, indented and not folded, and a closing result line.
3. **It fails** (in either mode): never folded. The `✗` line, the detail
   indented beneath it, then the failure propagates and `Action.run` writes the
   error annotation.

Warnings and errors are never held: they become annotations the moment they
happen, and the result line counts them (`⚠ peer check · 1 warning`).

```text
Checkout savvy-web/app @ pull/40/merge
  ▸ ✓ git 2.56.1 · fresh clone                          0.1s
  ▸ ✓ fetched 21cef44 · depth 1                         1.2s
    ✓ credentials kept for the job
```

## `ActionLogger`'s members

```ts
import { ActionLogger } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger;
  yield* logger.phase(
    "Runtime Setup",
    logger.step("pnpm install", Effect.logInfo("resolving"), {
      window: "2 minutes",
      summary: () => "pnpm install · lockfile frozen",
    }),
  );
});
```

- **`phase(title, effect)`** — the plain bold heading described above. It
  changes no state: the steps inside it fold as top-level steps. Inside a step
  it is a line of that step's detail.
- **`step(name, effect, options?)`** — a step. `options.window` is how long the
  detail is held (30 seconds by default; zero always streams). `options.summary`
  is a function of the step's **result** and replaces the name on the success
  line; `options.failure` is a function of the failure's `Cause` and replaces
  the name and message on the `✗` line (without it, the line reads
  `<name> · <first line of the failure's message>`, and an interruption reads
  `<name> · interrupted`). The mark is derived: `✗` on failure or interruption,
  `⚠` when the step or any step inside it logged a warning or error (or a nested
  step failed and was recovered from), `✓` otherwise.
  - Only the **outermost** open step has a window; an inner step's window is
    ignored, it opens no group of its own and renders as a result line inside
    the outer step's detail. If the outer step goes live, inner result lines
    print as they finish.
  - **Concurrent steps** that are live at once prefix each detail line with the
    outermost step's name in brackets, so the lines can be told apart.
  - **Runner debug** (`RUNNER_DEBUG=1`), or an ambient minimum log level of
    `Debug` or lower, makes every window zero: each step prints an opening
    line, streams its detail and closes with its result line.
  - Detail includes `Debug` and `Trace` lines in the fold, in the failure
    spill and in live output, so a library's debug transcript (the git
    transcript is one) shows in all three.
  - Writes straight to `Console` inside a step are captured as detail, as are
    `@effected/cli-kit`'s renderers; a workflow command written there goes out
    at once, so an `::add-mask::` still reaches the runner first.
  - Masking needs no logger change: the runner masks every registered secret
    in every line, held or live, so register a secret (`Secret.mask`) before it
    can appear in any line.
- **`ActionLogger.command(command, { display? })`** — runs a child process and
  writes `$ <command line>`, each stdout and stderr line as it arrives, and
  `exit <code>` as the current step's detail. A child spawned with
  `stdout: "inherit"` writes straight to the runner log and defeats the fold, so
  run it through `command` instead. It resolves with the exit code, whatever it
  is, and the collected stdout; only a failure to spawn is an error.
- **`group(name, effect)`** — a raw collapsible for dumping a block of text:
  opens `::group::name`, runs `effect`, always closes with `::endgroup::` via a
  bracket. **The runner cannot nest groups** — a second `::group::`
  implicitly closes the first — so `group` is nesting-aware: only the
  outermost call writes the command pair, and a `group` called inside it
  writes one `▸ <name>` header line (line breaks collapsed, the text
  neutralized). Inside a step the group depth is already at least 1, so `group`
  and `@effected/cli-kit`'s `Render.githubLog` / `Doc.print` render plain lines.
  The depth is fiber-scoped: concurrent sibling groups on separate fibers still
  interleave, a fiber forked inside a group keeps the depth it was forked at,
  and only a writer that reads the shared depth is counted. The depth lives
  in the fiber-local keyed by `WorkflowCommand.groupDepthKey` (from
  `@effected/github-commands`, which holds the key, never the reference),
  and `@effected/cli-kit` reads the same key. A raw `WorkflowCommand.group`, or a
  wrapper that does not read the key, opens a group the count cannot see.
- **`notice(message, properties?)`** — emits `::notice::`. A dedicated
  member, not a log level, because Effect has no level between `Info` and
  `Warn` to map a notice onto.
- **`annotated(properties, effect)`** — attaches source annotations
  (`title`, `file`, `startLine`, `endLine`, `startColumn`, `endColumn`) to
  every `Effect.log*` inside `effect`. The readable field names are this
  package's vocabulary; the wire renderer's private mapper is the **only**
  place they become GitHub's abbreviated wire names (`line`, `col`). Reach
  for `annotated` any time source location matters for a log line — the
  alternative is a caller spelling an annotation key by hand and risking a
  typo the runner silently ignores.

## Test defaults

`ActionLogger.layerSilent` is a bound constant merging a silent service
double with an empty logger — a recorded exception to the die-on-unstubbed
rule, alongside a small handful of others across the suite: a logger that
dies when a suite logs would make every double unusable.
`ActionLogger.layerTest(overrides?)` builds the same double with per-member
overrides; its `group`, `phase` and `step` pass the effect through and model
neither nesting nor the step log.

To assert on the log's **structure** rather than its rendered text, provide
`ActionLogger.recording()`: it returns `{ layer, entries }`, and `entries()`
returns `StepLogEntry` values, a phase (`{ kind: "phase", title }`) or a step
(`{ kind: "step", name, outcome, summary, detail, steps }`) where `outcome` is
`"success"`, `"warning"`, `"failure"` or `"interrupted"`, `summary` is the
result line's text without its mark, count or duration, `detail` is the lines
logged below `Warn` inside the step, and `steps` the steps opened inside it.
Nothing is written to the console.

## `WorkflowCommand`: the low-level protocol, touched directly only rarely

`WorkflowCommand` is **pure** — no IO, no service, just string rendering —
which is what makes the escaping testable with no runner and reusable
outside Actions. Members: `render`, `debug`, `notice`, `warning`, `error`,
`group`, `endGroup`, `addMask`, and the constant `groupDepthKey` — the key of
the fiber-local open-group count that `ActionLogger.group` and `@effected/cli-kit`'s
`Render.context` each build their reference from (the package holds the key,
never the reference, since it imports no `effect`). The escaping order is
load-bearing: `%` is
replaced **first**, or a later `\r`/`\n` substitution's own `%` would get
re-escaped. A legitimate reason to reach for it directly: rendering a
command's exact wire text in a unit test with no runner and no service —
which is exactly what `ActionOutputs.setFailed` and `.setSecret` do
internally. It lives in the pure, dependency-free `@effected/github-commands`
and `@effected/github-actions` re-exports it, so an action imports it from
either.

The opposite direction is `CommandNeutralizer` (same package): the runner
reads a line as a command when it starts with `::` (after whitespace) or
contains `##[` anywhere, so text the program did not author — an error
message, file contents — can smuggle in `::add-mask::` or `##[group]`.
`ActionLogger.logger` already neutralizes an `Info` line and escapes the
data of the levels it renders as commands; text written to stdout any other
way goes through `CommandNeutralizer.text` first.

## Masking

`ActionOutputs.setSecret(value)` emits `::add-mask::`, registering the
value with the runner's own log filter so it is redacted in every later
line, including ones this package never touches. `Redacted`, the
declassification seam, and cross-phase secret handling are
`actions-state-and-secrets`' subject — this reference stops at the one
workflow command.

## The logging contract as a design step

Write the logging contract deliberately, the same way an inputs module or
an error taxonomy gets designed rather than discovered:

- **A run-context opening block** — what the action is about to do, with
  what configuration, before any step runs.
- **The detect-headline pattern** — what was detected first, at `Info`;
  the evidence behind it, at `Debug`. A reader scanning the log gets the
  headline without wading through detail they didn't ask for.
- **Every skipped step logs `Step: X — SKIPPED: <reason>`, never
  silence.** A step that does nothing and says nothing looks identical to a
  step that never ran at all.
- **Warnings are reserved for acceptance signals**, not routine status. A
  warning that fires on every green run trains a reader to ignore warnings.
- **A closing result block** — what happened, in one place, at the end.

Enforce the contract with a test that asserts on the captured log stream —
not on return values, not on side effects, on the actual rendered lines.
The log **is** the decision record a later reader (human or another
action) trusts; a contract that isn't test-enforced drifts the first time
someone edits a log line for readability without checking what depends on
its exact shape.
