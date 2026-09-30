---
type: Decision
title: The audience flag is four shared root flags resolved into env's Audience
description: CliAudience declares --audience, --human, --agent and --ci as shared flags on the root command, each counted with Flag.atLeast(0), and resolves them with Command.provideEffect into env's Audience with source flag; more than one occurrence is a usage error.
status: draft
tags: [architecture, dx]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 5.2 and 11
  - id: p2-probe-audience-flag
    resource: probe P1 of the P2 plan, run on effect 4.0.0-rc.118 in the scratchpad
    title: "Probe P1: the audience flag shape"
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:28:29Z
  body_sha256: 366659960a6c7f2988cf7b8d2c9db9126f07df0d7c16539793ee6034088bfaa0
---

# The audience flag is four shared root flags resolved into env's Audience

## Context

A user overrides audience detection on one invocation with `--audience
<human|agent|ci>` or a boolean shorthand, and giving two of them is a usage
error even when they agree.[^interactive-cli-kit-design] The design left open
whether one `GlobalFlag.Setting` over a combined flag could do it or whether
several settings had to be merged, and probe P1 settled it against core's
source and real exit codes on rc.118.[^p2-probe-audience-flag]

Three facts from core shape the answer. There is no combinator that merges
several flags into one, so `Flag.orElse` is the only way to combine them, and
it tries the next alternative on *any* failure. A parent command's handler
does not run when a subcommand is selected, so a check in the root handler
never fires. And a bare `Command.run` exits 1 for a usage failure; the 64
comes from `CliRuntime.main`.

## Decision

`CliAudience` declares four flags, `--audience <v>`, `--human`, `--agent` and
`--ci`, as **shared flags on the root command** (`Command.withSharedFlags`),
accepted before or after the subcommand. Each is declared with
`Flag.atLeast(0)`, so every occurrence is visible to the resolver.
`CliAudience.provide` is piped onto the composite root (after
`withSubcommands`) and uses `Command.provideEffect` to resolve the four
flags before every subcommand handler runs:

- more than one occurrence across the four flags, even two that agree, fails
  with a `CliError.UserError`, which exits 64 under `CliRuntime.main`
  ([D7](usage-exit-code-defaults-to-64.md));
- exactly one re-provides env's `Audience` as `{ kind, source: "flag" }`;
- none leaves the ambient `Audience`, the override variable or detection,
  untouched.

`audience` is declared with `Flag.Literals`, so a bad value is core's own
parse error and also exits 64.

### The help limitation

Core cannot show a shared flag only in the root's help: the four flags appear
in the root's help and again in every subcommand's. `CliAudience.flags` takes
a `hidden` option that applies `Flag.withHidden` to all four, for a consumer
who prefers to describe them in the root description; they still parse and a
conflict still exits 64.

A conflicting audience together with `--help` exits 0 and prints help,
because core's action flags win before the resolver runs. That is core's
precedence, documented rather than worked around.

## Alternatives rejected

- **One `GlobalFlag.Setting` over an `orElse` chain.** Rejected. It compiles
  and reads as an `Option`, but it cannot see that two flags were given, so
  `--agent --ci` exits 0, and `orElse` swallows a bad value, so `--audience
  bogus` exits 0 as if no audience were given.
- **Four `GlobalFlag.Setting`s merged by a resolver.** Rejected. The conflict
  check works and exits 64, but a global setting parses its flag in a step
  that fails with a bare `CliError.InvalidValue`, so a bad `--audience` value
  exits 1, not 64. Avoiding that means declaring `audience` as a plain string
  and validating it by hand, on top of four services and a required ordering
  of `provideEffectDiscard` before `withGlobalFlags`.

## Consequences

The 64 is `CliRuntime.main`'s, so a program using bare `Command.run` sees
exit 1 for the same failures. Nested subcommands of subcommands were not
probed; shared flags are documented as inherited by descendants.

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`

[^p2-probe-audience-flag]: probe P1 of the P2 plan, run on effect 4.0.0-rc.118 in the scratchpad
