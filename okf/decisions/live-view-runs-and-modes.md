---
type: Decision
title: A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run
description: "CliUi.live folds a Stream into state inside the caller's scope; a run begins at an isStart event (or where an optional begins predicate says, given the state before and after) and ends at an isTerminal event, and an event outside a run that begins none is folded and not drawn, which unmounts and commits the frame; hosted and owned differ only when not interactive, neither mounts input hooks, and interactive is passed explicitly rather than left to Ink's is-in-ci guess (probes L1, L5, L6)."
status: draft
tags: [architecture, dx]
sources:
  - id: p5-probes
    resource: ../../docs/superpowers/specs/2026-10-01-p5-probes.md
    title: "P5 planning probes L1-L8, run 2026-10-01 on ink 7.1.1, react 19.3.0, effect 4.0.0-rc.118"
  - id: ink-render
    resource: "npm:ink@7.1.1"
    title: "Ink 7.1.1, build/ink.js:706-708: interactive defaults to !isInCi && stdout.isTTY"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T11:49:06Z
  body_sha256: a8ef805bebbed4ecc425c12866d54d2f7aed78ff3974125a3ff626b65dba3788
---

# A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run

## Context

`CliUi.run` mounts one screen and waits for an answer. A reporter's progress
view is the other shape: a stream of events that may span several runs (a
watch mode) and never ends on a key. vitest-agent hand-rolled that view; the
kit takes it over in P5.

Three probe findings shape it.[^p5-probes] Remounting on the same stdout
straight after `unmount()` is clean, while mounting twice warns, reuses the
instance and tears the frame (L5). Inside a Vitest worker stdout is a
non-TTY socket and Ink's `is-in-ci` guess resolves to non-interactive, while
the main process is a TTY (L6). `renderToString` honours the kit's colour
level and runs hooks, but terminal hooks there read the unprovided default
stdout (L1).

## Decision

- **A scoped drain.** `live` acquires the stream's pull in the caller's
  scope before it returns, so a PubSub-backed stream is subscribed before
  the first publish, then forks a drain that folds each event into state.
  Closing the scope interrupts the drain and unmounts.
- **Runs.** A run begins at an `isStart` event and ends at an `isTerminal`
  event. An optional `begins(event, before, after)` widens what begins a run
  while none is going (its default is `isStart(event)`), for a consumer that
  joins a run mid-way: vitest-agent passes `RunStarted`, or the phase going
  from idle to anything else. An event while no run is going that begins none
  is folded and not drawn. The end of a run is Ink's own `unmount()`, which
  commits the final frame; the next start mounts fresh. A start while mounted
  re-renders in place. The fold is never reset by the kit: that is the
  reducer's job.
- **The mount permit is held per run,** from mount to unmount, not for the
  view's whole life, so a `CliUi.run` between runs mounts and one during a
  run waits.
- **Two modes, `owned` (default) and `hosted`, differ only when not
  interactive.** `owned` writes the final frame once as a string, through
  `renderToString` at the stdout width with the kit's size override;
  `hosted` writes nothing, since its host owns the output.
- **No input.** Neither mode mounts `useInput` or `usePaste`, so raw mode is
  never entered and Ctrl-C stays the platform's SIGINT, which interrupts the
  program and closes the scope.
- **`interactive` is passed to Ink explicitly,** from `CliInteractive`,
  never left to Ink's default.[^ink-render]

## Alternatives rejected

- **Any event while nothing is drawn begins a run.** It is what joins a run
  mid-way, but vitest-agent publishes `CoverageReady`, `ThresholdViolation`
  and `TrendComputed` after `RunFinished` (and `WatcherReady` in watch mode),
  so it mounted a second copy of the finished run and left a live frame up
  while idle. Joining mid-way is the consumer's to opt into, through `begins`.

- **Holding the permit for the view's whole life.** It would block every
  prompt for as long as a reporter lives, including between watch runs.
- **Skipping the permit.** Ink keys instances by stdout, so a prompt during
  a run would hijack the live instance (L5).
- **Letting Ink decide `interactive`.** Its `is-in-ci` guess is wrong in a
  Vitest worker and ignores the kit's agent audience (L6).
- **An `owned` mode with Ctrl-C handling.** It needs raw mode, which steals
  stdin from a host; SIGINT already ends the scope.

## Consequences

- A hosted view in a Vitest main process is torn by a worker's raw
  `process.stdout` or `process.stderr` writes, which Vitest pipes straight
  through. The kit cannot intercept them; it is documented, not fixed.
- `useTerminalSize` needs a size override for the `renderToString` path,
  which `UiProvider`'s `size` provides.

[^p5-probes]: `docs/superpowers/specs/2026-10-01-p5-probes.md`, sections L1, L5 and L6
[^ink-render]: `npm:ink@7.1.1`, `build/ink.js:706-708`
