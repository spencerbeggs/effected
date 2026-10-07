---
type: Decision
title: The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
description: "At mount the kit resolves the chalk that Ink imports, from Ink's own location, sets its level from the stream's ColorLevel and restores it on release; FORCE_COLOR, a kit chalk dependency and token-only styling were each measured and rejected (probe P2)."
status: draft
tags: [compat, dx]
sources:
  - id: probe-p2
    resource: "P4 design probe P2, run 2026-09-30 on node 26.10.0 with ink 7.1.1, react 19.3.0 and Ink's own chalk 5.6.2, in pipe and pty venues and under npm and pnpm layouts"
    title: "Probe P2: forcing Ink's colour level"
  - id: ink-colour
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0: build/colorize.js, components/Text.js and render-border.js import the default chalk instance (chalk ^6.0.1)"
  - id: chalk-level
    resource: "npm:chalk@6.0.1"
    title: "chalk 6.0.1, source/index.js:17-37: level is a validating accessor over a stored value every style getter reads"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: 4e1c45ba39bdad5b12f25eed1a3838d40db43690e3fb34ca59edef226689e5aa
---

# The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location

## Context

Ink colours through its own copy of chalk. `colorize.js`, `Text.js` and
`render-border.js` all import chalk's default instance, which computes its
level once, at import, from `FORCE_COLOR`, the TTY and `TERM`. It ignores
`TerminalEnv`. Every style getter reads the level at call time, so setting
`chalk.level` is live. Ink's `exports` has only `"."`, and chalk is its own
direct dependency, so the kit cannot deep-import it.[^ink-colour]

A consumer's own components, such as vitest-agent's `StreamApp`, pass colour
props straight to Ink. So the kit has to force the level itself, not just
drop colour props from its own widgets.

## Decision

When a screen mounts, after the lazy `import("ink")`, the kit:

1. resolves Ink's chalk from Ink's location, with
   `createRequire(fileURLToPath(import.meta.resolve("ink"))).resolve("chalk")`,
   then `realpath`, then `import()`;
2. maps the stream's `ColorLevel` to a chalk level (`none` 0, basic 1, 256
   colours 2, truecolor 3), saves the previous level and sets the new one;
3. restores the saved level in the release of the same `acquireRelease`.

`@effected/cli` takes **no `chalk` dependency of any kind**. Resolving from
Ink's location gives the identical instance by construction: Node's ESM
loader keys modules by realpath, and pnpm's symlink to Ink's chalk resolves
to the file Ink imports. The kit's widgets still style only through
`CliTheme` tokens, but colour correctness does not rest on that.

## Alternatives rejected

Each was measured in probe P2.[^probe-p2]

- **(a) Set `FORCE_COLOR` around the first `import("ink")`.** Rejected.
  With chalk already imported before the forced import, the forced level was
  ignored entirely. The level is decided once per process, so a second
  screen wanting a different level kept the first one. A non-zero value is a
  floor, not a level: `FORCE_COLOR=1` gave level 3, because chalk then read
  the inherited `COLORTERM=truecolor`.
- **A bare `chalk` dependency on the kit.** Rejected. With a top-level chalk
  5.3.0 and Ink's nested chalk 5.6.2, setting the level on the kit's copy had
  **no effect** on Ink's output.
- **(c) Kit tokens only, dropping colour props at `none`.** Rejected as the
  mechanism. It cannot be enforced, since Ink's `<Text color>` stays in the
  types. `Text.js` calls `chalk.bold` and `chalk.dim` directly, and
  `render-border.js` calls `chalk.dim`, so "no colour props" is not
  escape-free unless the level is also 0.

Option (b), the decision above, produced plain output at level 0 and
coloured output at levels 1 and 2, in both directions within one process, on
a pipe and on a pty, and under both the npm and pnpm layouts.

## Consequences

- **The mechanism holds on Ink 8, which nests chalk 6.** Its `level` is an
  accessor that validates the value and stores it where every style getter
  reads it, so setting it is still live;[^chalk-level] the kit's colour-level
  tests pass on Ink 8. Probe P2's measurements were taken on Ink 7 and chalk
  5 and were not re-run.
- **The level is process-global while a screen is mounted.** Two concurrent
  screens wanting different levels cannot coexist: the last mount wins.
  Restoring on release bounds it.
- **The resolution can fail** when a consumer bundles Ink into its own
  output. The kit then degrades explicitly, warning once, and never fails
  silently.
- **An Ink change could make the level inert**, for example by Ink dropping
  the default chalk export. A kit test renders a consumer's `<Text
  color="red" bold>` at colour `none`, on a stream whose `FORCE_COLOR` says
  otherwise, and asserts an escape-free frame. That is the positive control
  that keeps this decision honest across Ink bumps.

[^ink-colour]: `npm:ink@8.0.0`, `build/colorize.js`, `build/components/Text.js` and `build/render-border.js`
[^chalk-level]: `npm:chalk@6.0.1`, `source/index.js:17-37`
[^probe-p2]: Probe P2, run 2026-09-30 against ink 7.1.1, react 19.3.0 and chalk 5.6.2.
