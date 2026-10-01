---
type: Decision
title: The audience flag is four shared root flags resolved into env's Audience
description: CliAudience declares --audience, --human, --agent and --ci as shared flags on the root command, each counted with Flag.atLeast(0), and resolves them with Command.provideEffect into env's Audience with source flag; more than one occurrence is a usage error.
status: draft
tags: [architecture, dx]
sources:
  - id: core-param
    resource: ../../.repos/effect/packages/effect/src/cli/Param.ts
    title: Core Param, the flag combinators and parseFlag
  - id: core-command
    resource: ../../.repos/effect/packages/effect/src/cli/Command.ts
    title: Core Command, withSharedFlags, provideEffect and runWith
  - id: core-help
    resource: ../../.repos/effect/packages/effect/src/cli/internal/help.ts
    title: Core help builder, which lists shared and global flags
  - id: core-cli-error
    resource: ../../.repos/effect/packages/effect/src/cli/CliError.ts
    title: Core CliError, ShowHelp and its exit code
  - id: cli-runtime
    resource: ../../packages/cli/src/CliRuntime.ts
    title: CliRuntime, which remaps usage failures to exit 64
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: e277224bfe5607a42622b1501bd86248275033b395a1c2414495076131899eb9
---

# The audience flag is four shared root flags resolved into env's Audience

## Context

A user overrides audience detection on one invocation with `--audience
<human|agent|ci>` or a boolean shorthand, and giving two of them is a usage
error even when they agree. It was open whether one `GlobalFlag.Setting` over
a combined flag could do that or whether several settings had to be merged. A
probe of three shapes against core's source, with real exit codes read from
running each program under `CliRuntime.main`, settled it.

### Source facts the design rests on

- **No merge-N-flags combinator.** The flag combinators are single-flag:
  `map`, `optional`, `withDefault`, `atLeast`, `orElse`, `withHidden` and the
  rest. `Flag.orElse` tries the next alternative on any failure, so it cannot
  see that two flags were given.[^core-param]
- **`parseFlag` reads only the first value** of a flag, so `--agent --agent`
  is silently fine unless the flag is variadic; `Flag.atLeast(0)` returns
  every occurrence.[^core-param]
- **A parent's handler does not run when a subcommand is selected.** Only the
  child's handler does, so a check in the root handler never fires.
  `Command.provideEffect` applied to the composite root, after
  `withSubcommands`, wraps the dispatching handler and so runs before every
  subcommand handler.[^core-command]
- **Shared flags are accepted before or after the subcommand**
  (`Command.withSharedFlags`) and arrive as plain input fields, with no
  global-flag machinery.[^core-command]
- **No per-path help filtering.** Shared and global flags are listed in every
  command's help; the only lever is `Flag.withHidden`.[^core-help]
- **Core exits 1 for a usage failure.** `ShowHelp` carrying errors has exit
  code 1 and a handler-raised `CliError.UserError` is rendered and re-failed;
  the 64 comes from `CliRuntime.main`, which remaps both to `usageExitCode`
  ([D7](usage-exit-code-defaults-to-64.md)).[^core-cli-error][^cli-runtime]

## Decision

`CliAudience` declares four flags, `--audience <v>`, `--human`, `--agent` and
`--ci`, as **shared flags on the root command** (`Command.withSharedFlags`).
Each is declared with `Flag.atLeast(0)`, so every occurrence is visible to the
resolver. `CliAudience.provide` is piped onto the composite root and uses
`Command.provideEffect` to resolve the four flags before every subcommand
handler runs:

- more than one occurrence across the four flags, even two that agree, fails
  with a `CliError.UserError`, which exits 64 under `CliRuntime.main`;
- exactly one re-provides env's `Audience` as `{ kind, source: "flag" }`;
- none leaves the ambient `Audience`, the override variable or detection,
  untouched.

`audience` is declared with `Flag.Literals`, so a bad value is core's own
parse error and also exits 64. Only a `true` boolean counts as an
occurrence: `--agent=false` and `--no-agent` mean "not given" and fall
through to `--audience` or the ambient `Audience`, so they neither select an
audience nor conflict with another flag.

## What the probe showed

Shape (c), the chosen one, run through `CliRuntime.main` with a two-subcommand
program (`verify`, `other`) and the ambient audience unset:

| Arguments | Result |
| --- | --- |
| `verify x` | exit 0, no audience |
| `--agent verify x` | exit 0, agent |
| `verify x --agent` | exit 0, agent |
| `verify x --audience ci` | exit 0, ci |
| `--agent verify x --ci` | exit 64, one `ERROR` line from the `UserError` |
| `verify x --agent --ci` | exit 64 |
| `--agent --agent verify x` | exit 64 |
| `--agent --audience agent verify x` | exit 64 |
| `--audience ci --audience ci verify x` | exit 64 |
| `verify x --audience bogus` | exit 64, core's own `ShowHelp` with the invalid-value error plus help |

Every repeat counts, even when the values agree, and placement before or after
the subcommand makes no difference.

The two rejected shapes, each run the same way:

| Shape | Arguments | Result |
| --- | --- | --- |
| One `Setting` over an `orElse` chain | `--agent --ci verify x` | exit 0, agent: no conflict detection |
| One `Setting` over an `orElse` chain | `--agent --audience agent`, `--agent --agent` | exit 0 |
| One `Setting` over an `orElse` chain | `--audience bogus verify x` | exit 0, no audience: `orElse` swallows the invalid value |
| Four `Setting`s plus a resolver | `--agent --ci`, `--agent --agent`, `verify x --agent --ci` | exit 64 |
| Four `Setting`s plus a resolver | `--audience bogus verify x`, `audience` as `Flag.Literals` | exit 1: a global setting's flag is parsed in a step that fails with a bare `CliError.InvalidValue`, not wrapped in `ShowHelp`, so it never reaches the 64 remap |

The four-`Setting` shape reaches 64 for a bad value only if `audience` is
declared as a plain string and validated by hand in the resolver, and it needs
`provideEffectDiscard` ordered before `withGlobalFlags` or the four ids stay in
`R`.[^core-command]

### The help limitation

The four flags appear in the root's help and again in every subcommand's,
because core lists shared flags per command.[^core-help] `CliAudience.flags`
takes a `hidden` option that applies `Flag.withHidden` to all four, for a
consumer who prefers to describe them in the root description; hidden, they
vanish from every help, still parse, and a conflict still exits 64.

A conflicting audience together with `--help` exits 0 and prints help,
because core's action flags win before the resolver runs. That is core's
precedence, documented rather than worked around.

## Alternatives rejected

- **One `GlobalFlag.Setting` over an `orElse` chain.** Rejected. It compiles
  and reads as an `Option`, but it has no conflict detection and swallows a
  bad value, per the table above.
- **Four `GlobalFlag.Setting`s merged by a resolver.** Rejected. Conflicts
  exit 64, but a bad `--audience` value exits 1, and the workaround adds four
  services and an ordering constraint for nothing shape (c) needs.

### The parse-order gap, and `run` / `runWith`

`CliAudience.provide` alone cannot gate a fallback prompt. Core parses the root flags into a local context and then
runs the subcommand's parse, where a fallback fires, before any parsed flag is visible to it; `provideEffect`
wraps only the subcommand handler.[^core-command][^core-param] So `--agent init` on a human-detected
terminal would still prompt. `CliAudience.runWith` and `run` close it: a pure scan of argv, mirroring the four
flags' syntax and sharing the counting rule with the resolver, runs before core, and the whole run is wrapped in
the provided `Audience` (`source: flag`) and a `CliInteractive` decided to match. The terminal gate decides per
call, not at build, so the decision reaches it.

### A flag decides interactivity from the TTY facts

A flag that names the audience does not just narrow `CliInteractive`; it recomputes it from that audience and
`TerminalEnv`: interactive means `human` with a terminal on both stdin and stdout and a `TERM` that is not `dumb`, the
same decision `CliInteractive.layer` makes. So `--human` can widen. A person
who runs the tool inside an agent (detected `agent`) on real terminals gets the prompt back, which the flag's
higher precedence over the environment variable already promised, and a pipe still cannot prompt, because the TTY
requirement is unchanged and only the audience input moves. A non-human flag, or a conflict, still makes it false.
Without `TerminalEnv` in the environment there are no facts to decide from and the flag only narrows. `--wizard`
follows the decision: a run a flag makes interactive gets it back where the environment's gate had dropped it, and only there. `gateWizard` records that it removed the flag, so a consumer who left `Wizard` out of their own `builtIns` keeps it out. This
came from okfit's round-2 adoption, where `--human` under Claude Code skipped the prompt on a real pty.

## Consequences

The 64 is `CliRuntime.main`'s, so a program using bare `Command.run` sees
exit 1 for the same failures. Nested subcommands of subcommands were not
probed; shared flags are documented as inherited by descendants.

[^core-param]: `.repos/effect/packages/effect/src/cli/Param.ts`: `orElse` near line 1895, `parseFlag` near line 1996 reading only `providedValues[0]`; and `withFallbackPrompt` running the prompt inside the parse, near lines 1478 to 1485.

[^core-command]: `.repos/effect/packages/effect/src/cli/Command.ts`: `withSharedFlags` near line 979, `provideEffect` near line 1560, the subcommand `handle` near lines 925 to 942, the setting-parse step of `runWith` near lines 1975 to 1990, and the root flags parsed into a local context near lines 922 to 925 with the subcommand `handle` wrapped by `impl.service` near line 941.

[^core-help]: `.repos/effect/packages/effect/src/cli/internal/help.ts`: shared and global flags collected for every command path near lines 160 to 182, skipping only `hidden` ones.

[^core-cli-error]: `.repos/effect/packages/effect/src/cli/CliError.ts`: `ShowHelp` carries `Runtime.errorExitCode` of 1 when it has errors, near line 656.

[^cli-runtime]: `packages/cli/src/CliRuntime.ts`: a `ShowHelp` with errors and a rendered `UserError` exit with `usageExitCode`, default 64.
