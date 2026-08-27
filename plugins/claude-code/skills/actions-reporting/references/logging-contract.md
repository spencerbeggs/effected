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

## `ActionLogger`'s four members

```ts
import { ActionLogger } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger;
  yield* logger.group("install", logger.withBuffer("pnpm", Effect.logInfo("resolving")));
});
```

- **`group(name, effect)`** — opens `::group::name`, runs `effect`, always
  closes with `::endgroup::` via a bracket. On a failing cause it flushes
  whatever buffer is currently active *before* the group closes, so a failed
  step's transcript lands inside the collapsed section it belongs to rather
  than after it.
- **`withBuffer(label, effect, options?)`** — the quiet-green / verbose-red
  mechanism. `Warn` and `Error` entries still go out live, rendered the same
  way as the installed logger; everything `Info` and below is held and
  flushed on **every** exit path, including a defect or interruption.
  `WithBufferOptions.onSuccess: "flush" | "discard"` (default `"flush"`)
  decides only what a **success** is worth in the log: `"discard"` drops the transcript on a
  clean exit — one line per green step — while a failure, a defect or an
  interruption still flushes under either setting. Buffering is skipped
  entirely — the effect just runs, overriding `onSuccess: "discard"` too —
  when the runner has step debugging on or the ambient minimum log level is
  already `Debug` or lower: someone who asked for verbose output gets it
  live, not replayed at the end. `isDebug` alone does not lower that
  ambient minimum — see `actions-runtime`'s `isDebug` → `MinimumLogLevel`
  reference for the wiring a program still has to do itself.
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
overrides.

## `WorkflowCommand`: the low-level protocol, touched directly only rarely

`WorkflowCommand` is **pure** — no IO, no service, just string rendering —
which is what makes the escaping testable with no runner and reusable
outside Actions. Members: `render`, `debug`, `notice`, `warning`, `error`,
`group`, `endGroup`, `addMask`. The escaping order is load-bearing: `%` is
replaced **first**, or a later `\r`/`\n` substitution's own `%` would get
re-escaped. A legitimate reason to reach for it directly: rendering a
command's exact wire text in a unit test with no runner and no service —
which is exactly what `ActionOutputs.setFailed` and `.setSecret` do
internally.

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
