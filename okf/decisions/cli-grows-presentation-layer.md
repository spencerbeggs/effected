---
type: Decision
title: "@effected/cli grows a presentation layer and interactive UI"
description: "@effected/cli takes on audience, interactivity, theme, status vocabulary, messages, the document IR, failure rendering and logging composition in its React-free root, and interactive screens behind ./ui, replacing the not-a-framework limitation's ban on prompts and spinners."
status: stable
supersedes: ../limitations/cli-is-not-a-framework.md
tags: [architecture, dx]
sources:
  - id: cli-presentation-audit
    resource: https://github.com/spencerbeggs/effected/issues/838
    title: "Issue 838: the audit of presentation code consumers re-derive"
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:33:06Z
  body_sha256: 8292533ae4f0be2ff46c0e69f5a82e99446bbba7015354cbbd2af2ebced7ff8d
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# @effected/cli grows a presentation layer and interactive UI

## Context

[The not-a-framework limitation](../limitations/cli-is-not-a-framework.md)
kept `@effected/cli` to a plain-text logger, failure reporting and two
renderers, and sent a consumer who wanted prompts or spinners to core's
`Prompt`. Consumers did not stop needing the rest: the audit in issue 838
found each of them re-deriving the same audience detection, colour decision,
status glyphs, truncation, duration and percent formatting, and log
composition, and getting it differently each time.[^cli-presentation-audit]
The interactive CLI kit is the answer, and it needs `@effected/cli` to own
that layer.

## Decision

`@effected/cli` grows a presentation layer in its **React-free root**:

- audience and interactivity: the `--audience` flags and `CliInteractive`;
- a theme: colour tokens, glyphs and an open status vocabulary;
- user-facing messages, separate from diagnostics;
- the document IR and its renderers (planned, P3);
- failure rendering on that IR (planned, P3);
- logging composition, for a diagnostics level and sinks that coexist with
  `CliLogger`.

It also grows interactive screens behind a `./ui` subpath (planned, P4),
which the root never reaches. The root stays
[boundary tier](../glossary/library-tier.md): no platform package, no
runtime dependency, and `@effected/env` as a required peer (see
[its own package](env-is-its-own-package.md)).

## What still holds

`effect/cli` owns argument parsing, flags, the command tree and the help
system. The kit never builds a second framework: nothing added here parses
arguments or declares a command tree, and a change that starts to look like
that belongs upstream or nowhere. Nothing in the kit may depend on
`@effected/cli` except an application.

## Alternatives rejected

- **A separate `@effected/cli-ui` package.** Rejected. The presentation layer
  is consumed by the same programs that already depend on `cli`, and a second
  package would split one boundary into two peers that must resolve to one
  copy of each service tag, for no install saving a consumer could use.
- **A separate `cli-ink` package for the interactive screens.** Rejected for
  the same reason, and because the optional peers `ink` and `react` cost a
  consumer who never imports `./ui` nothing.

## Consequences

The limitation is deprecated and this Decision supersedes it. Its one open
question, colour-aware output, is settled by
[honouring FORCE_COLOR](force-color-honoured-node-precedence.md) through
`@effected/env`. The [`cli` Module](../modules/cli.md) documents the new
surface, and the package's `CLAUDE.md` points here instead of banning prompts.

[^cli-presentation-audit]: <https://github.com/spencerbeggs/effected/issues/838>
