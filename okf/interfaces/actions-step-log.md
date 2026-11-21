---
type: Interface
title: actions-step-log
description: "The rendering contract of ActionLogger's step log: phases and steps, the quiet window, the held, live and failure forms, result marks, nesting, concurrency, and the five GitHub-log constraints they are built on."
status: draft
kind: runtime
resource: ../../packages/github-actions/src/ActionLogger.ts
tags:
  - architecture
  - dx
sources:
  - id: step-log-source
    resource: ../../packages/github-actions/src/internal/stepLog.ts
  - id: action-logger-source
    resource: ../../packages/github-actions/src/ActionLogger.ts
  - id: step-log-tests
    resource: ../../packages/github-actions/__test__
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-21T22:35:23Z
integrity:
  generated:
    body: 959e8407d5a5e496
---

# actions-step-log

## Contract

`ActionLogger` gives every kit action one readable log shape: one line per
step, the detail a click away, and live output when a step is slow enough
that someone needs to watch it. `phase(title, effect)`,
`step(name, effect, options?)` and the static `ActionLogger.command` and
`ActionLogger.recording` are the whole surface; `group`, `notice` and
`annotated` remain beside them. One renderer owns the console, the
group depth and the step state (a fiber-local reference), so nesting,
concurrency and the [`cli-kit`](../modules/cli-kit.md) group interplay have
one owner.[^step-log-source] It is the standard log for kit actions, and the
[GitHub Action canon](../conventions/github-action-canon.md) requires it.

## What the GitHub log can do

The shape is built on five constraints, so a builder does not rediscover
them:

- The log is append only: no line is rewritten, so there are no spinners.
- `::group::<title>` and `::endgroup::` fold their body; the title is fixed
  when the group opens and stays visible.
- Groups do not nest: a second `::group::` closes the first.
- A group cannot be opened automatically, so a folded failure is a hidden
  failure.
- ANSI colour renders, `::debug::` lines show only with runner debug on, and
  `::warning::` and `::error::` become annotations on the run summary.

## Phase and step

A **phase** is a plain bold heading, never folded outside a step; inside one it
is a heading line of the step's detail. It writes nothing when it ends and
changes no state. A **step** is the unit with a quiet window and a
result line. The result line is `<mark> <summary or name> · <duration>`.

The mark is derived: `✗` on failure or interruption, `⚠` when the step or
any step inside it logged a warning or an error, or a nested step failed and
was recovered from, and `✓` otherwise. The line counts warnings
(`⚠ peer check · 1 warning`). `StepOptions` carries `window`, `summary`
(a function of the **result**) and `failure` (a function of the `Cause`;
without it the line reads `<name> · <first line of the message>`, and an
interruption reads `<name> · interrupted`).

A step's life:

1. It starts silently. Its **detail** is every log line below `Warn`, `Debug`
   and `Trace` included whatever the ambient minimum level, plus every line a
   nested `group` or step writes, plus every line written straight to
   `Console` inside it (`cli-kit` renderers, a raw `Console.log`).
2. **Finishing inside its window** writes one folded group titled by the
   result line, the detail inside. A step with no detail is a plain result
   line, and a step with any detail folds, even only an argv and an exit
   line.
3. **Running past its window** (30 seconds by default) writes
   `… <name> is taking longer than <window>, showing live output`, then
   everything held so far, then each detail line as it happens, indented and
   unfolded, then a closing result line. A live step always closes, even with
   no detail.
4. **Failing**, in either mode, is never folded: the `✗` line, the detail
   indented beneath it, then the failure propagates and `Action.run` writes
   the error annotation. An interruption writes `✗ <name> · interrupted` the
   same way, with the held detail.

Warnings and errors are never held: they go out the moment they happen as
annotations and count against the step and every step around it. A workflow
command written to `Console` inside a step is not detail either: it goes out
at once, so an `::add-mask::` reaches the runner before the secret can appear
in any line, except a group command, which becomes a `▸ <title>` header
line. Of `Console`'s members only `log`, `info`, `debug`, `trace`, `warn`,
`error` and `dirxml` are captured as detail; `table`, `dir`, `count`, the
`time*` and the `group*` members print through at once. A `summary` or
`failure` function that throws falls back to the default text, so the step
still closes, and durations come from the monotonic clock.

## Windows, nesting and concurrency

- A window of zero streams from the start with the opening line `… <name>`.
  Runner debug (`RUNNER_DEBUG=1`) or an ambient minimum log level of `Debug`
  or lower makes every window zero.
- **Only the outermost open step has a window.** An inner step's window is
  ignored: it prints no "taking longer" line, opens no group, and renders as
  a result line inside the outer step's detail. When the outer step is live,
  inner result lines print as they finish.
- A step opened inside a raw `group` cannot fold, so it writes its result
  line with the detail indented beneath it.
- Concurrent steps past their windows interleave, and **the `[name]` prefix
  applies only while two or more steps are streaming at once**, naming each
  line's outermost step.
- Inside a step the group depth is at least 1, so `group` and `cli-kit`'s
  `Render.githubLog` and `Doc.print` write plain lines through
  `WorkflowCommand.groupDepthKey`.
- A recovered inner failure makes every enclosing step `⚠`, and an outermost
  run in which any frame failed is written unfolded.
- A fiber forked inside a step that logs after the step ended is not
  dropped: its lines print as ordinary log lines, unindented and unprefixed.
- **Inside a step, the step's own logger replaces the installed loggers.**
  Every other logger the program installed (an OpenTelemetry exporter, a
  file logger) sees nothing logged inside a step; it sees only what is
  logged outside every step. A program that needs those entries elsewhere
  logs them outside the step.[^action-logger-source]
- Opening a step and arming its window is uninterruptible, with only the
  body interruptible, so an interruption at the start still writes the
  `✗ <name> · interrupted` line and never leaves a run streaming.

## Commands, masking and tests

A step can hold back only what reaches it. A child spawned with
`stdout: "inherit"` writes straight to the runner log and defeats the fold, so
`ActionLogger.command(command, { display? })` runs a child with `$ <argv>`
(secrets redacted), each stdout and stderr line as detail, and `exit <code>`
last, resolving `{ exitCode, stdout, stderr }`, each stream collected whole and
apart, so a caller can classify a failure from either (npm writes its error
code to stderr only). The collected text is not redacted: the runner masks
registered secrets in the logged lines, but a caller quoting the returned
strings scrubs them first. Reading stops 10 seconds after the
child exits, as `@actions/exec` does, so a grandchild that inherited the pipes
cannot hang it. It fails with `PlatformError` when the spawn, or reading the
output or the exit status, fails; a non-zero exit is never an error. Stdout is
decoded as text and logged line by line, so a binary stdout needs the raw
`ChildProcessSpawner` handle.
The [`git`](../modules/git.md) Debug transcript is the same idea for git,
arriving through Effect's logger.

Every line passes through `CommandNeutralizer.text`, so no detail line can be
a workflow command. Masking needs no logger change: the runner masks every
registered secret in every line it prints, held or live, so the requirement is
that a secret is registered (`Secret.mask`) before it can appear in any line.

`ActionLogger.recording()` returns `{ layer, entries }`; `entries()` is a list
of `StepLogEntry` values (a phase, or a step with `name`, `outcome` of
`success`, `warning`, `failure` or `interrupted`, `summary`, `detail` and
nested `steps`), so a test asserts on the log's structure rather than its
rendered text. The step log itself writes nothing to the console, but a raw
`Console` write inside a recorded step is not detail and still prints.
`makeTest`, `layerTest` and `layerSilent` pass `group`, `phase`
and `step` bodies through and model neither nesting nor the step log.

## Anti-goals

- A failure hidden in a fold.
- A slow step that prints nothing past its window.
- A secret in a held or live line that was masked nowhere.
- Two concurrent steps whose live lines cannot be told apart.

[^step-log-source]: `packages/github-actions/src/internal/stepLog.ts` — the
    renderer, its frame state and the held, live and prefix rules.

[^action-logger-source]: `packages/github-actions/src/ActionLogger.ts` — `step`
    provides `Logger.CurrentLoggers` as a set holding only the step's logger.
