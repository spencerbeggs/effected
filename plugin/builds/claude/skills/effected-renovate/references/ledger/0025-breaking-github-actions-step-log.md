---
id: "0025"
title: "@effected/github-actions: ActionLogger.withStep, withBuffer and heading are gone; phase and step replace them, and a child's inherited stdout is written through ActionLogger.command"
kind: breaking
shows: typed
applies:
  "@effected/github-actions": ">=0.36.0"
detect: ["withStep", "withBuffer", "WithStepOptions", "WithBufferOptions", "[Ll]ogger\\.heading", "stdout: .inherit."]
changesets: ["checkout-service-github-actions", "checkout-service-plugin"]
---

`ActionLogger` has one log shape now, the step log: a `phase` is a bold heading, and a `step` holds its detail and writes one result line. `withStep`, `withBuffer` and `heading` are removed, and so are the `WithStepOptions` and `WithBufferOptions` types, so the compiler finds every call site. A key by one of those names in an `ActionLogger.makeTest` or `layerTest` override object no longer compiles either. Move each hit as follows.

- `withStep(name, effect, { summary })` becomes `step(name, effect, { summary })`. `summary` is now a function of the step's **result** (`(result) => string`), where it was a fixed string, and replaces the step name on the success line. Add a `failure` option, a function of the failure's `Cause`, only where the default failure text (`<name> · <first line of the error message>`) is not enough. There is no `❌` header and no `✅` default line any more: the line carries a `✓`, `⚠` or `✗` mark and the duration.
- `withBuffer(label, effect, { onSuccess })` becomes `step(label, effect)`. A step folds its detail on success and writes it unfolded on failure, so `onSuccess: "discard"` and `"flush"` have no counterpart; drop the option. Where the old call wrapped work you wanted visible live, pass `window: "0 seconds"`.
- `heading(name, effect)` becomes `phase(name, effect)`. A phase is a bold heading that is never folded and writes nothing when it ends, so group-free `heading` bodies keep their shape. A `GitHubMarkdown.heading` call is a different member and stays as it is.
- Give each unit of work its own `step`, grouped under a `phase`. A step is quiet for its window (30 seconds by default, `window` takes a `Duration` input such as `"2 minutes"`), then streams live with a `… <name> is taking longer than <window>, showing live output` line. Only the outermost step's window counts, and `RUNNER_DEBUG=1` makes every window zero.
- A child process spawned with `stdout: "inherit"` (or `stderr: "inherit"`) writes straight to the runner log and defeats the fold. Run it through `ActionLogger.command(command, { display? })` inside a step instead: it writes `$ <command line>`, each output line and `exit <code>` as the step's detail, and resolves with `{ exitCode, stdout }`. A non-zero exit is not an error, so check `exitCode` and fail the step yourself.
- To test the log, provide `ActionLogger.recording()`, which returns `{ layer, entries }`, in place of a hand-rolled `ActionLogger.layerTest({ withStep: ... })` that captured calls. `entries()` returns `StepLogEntry` values: `{ kind: "phase", title }` or `{ kind: "step", name, outcome, summary, detail, steps }`, where `outcome` is `"success"`, `"warning"`, `"failure"` or `"interrupted"`, and `detail` holds the lines logged below `Warn` inside the step. Assert on those rather than on rendered text. The existing `layerTest` and `layerSilent` doubles pass `phase` and `step` bodies through unchanged.
- Where a step wraps a failure and recovers, the enclosing steps now turn `⚠` and the group is written unfolded. A test that read the old green summary line needs its assertion updated.

An action that needs a repository checked out can drop its separate checkout workflow step and call `Checkout.checkout` (and `Checkout.cleanup()` from its `post` entry for the default job-lifetime credential); that is new, not required by this change.

Check the installed `.d.ts` for `ActionLoggerShape` and `StepOptions` before editing.
