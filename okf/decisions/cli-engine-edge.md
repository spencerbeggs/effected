---
type: Decision
title: "@effected/cli depends on @effected/engine as a regular dependency, for distribution"
description: "CliRuntime.main's distribution option provides engine's CurrentDistribution and decorates --version with withDistributionVersion, so cli takes @effected/engine as a regular dependency rather than a peer or a private copy; engine is pure with no @effected peers, and its one shared contract is a string-keyed Context.Reference that a duplicate copy still meets."
status: draft
tags: [architecture, deps]
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    title: "kit-ports user ruling 2026-10-26: cli gets a regular dependency on engine, for the distribution option"
    author: human:spencer
    last_modified: 2026-10-26T00:00:00Z
  - id: cli-runtime
    resource: ../../packages/cli/src/CliRuntime.ts
    title: "MainOptions.distribution and the withCarrier wrapper over withDistribution and withDistributionVersion"
  - id: engine-distribution
    resource: ../../packages/engine/src/Distribution.ts
    title: "CurrentDistribution, a Context.Reference keyed \"@effected/engine/CurrentDistribution\", and withDistributionVersion"
  - id: core-context
    resource: ../../.repos/effect/packages/effect/src/Context.ts
    title: "Context.Reference is Context.Service with a default; lookup is by the string key"
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: e41ff7d8cb5b69db
---

# `@effected/cli` depends on `@effected/engine` as a regular dependency, for `distribution`

## Context

A carrier package (`@scope/plugin`) re-exposes a tool's bins and passes its
own identity to each front end's `main`. Two things follow from that
identity: the program, and the consumer engine it calls, read it as
`CurrentDistribution` to stamp envelopes; and `--version` ends with
`via <carrier> <version>` after a space. Every consumer used to wire both by hand around
`CliRuntime.main`, and the hand-written `--version` formatter replaced core's
coloured default rather than decorating it.

[D1](engine-holds-cross-front-end-primitives.md) put `Distribution` and
`CurrentDistribution` in `@effected/engine` so that a consumer's engine can
reach them without a front-end edge, and said that any new kit edge to
`engine` needs its own Decision. Folding the wiring into
`CliRuntime.main` needs exactly that edge.[^owner-ruling]

## Decision

`MainOptions.distribution` (`Distribution | null | undefined`) is the one
place a program states how its bin was installed. Given, even as `null`,
`CliRuntime.main` provides `CurrentDistribution` around the program with
engine's own `withDistribution`, and, with a carrier, updates core's
`CliOutput.Formatter` so its `formatVersion` is wrapped by
`withDistributionVersion(Option.some(distribution))`: whatever formatter is
in effect, coloured or custom, keeps its output and gains the
suffix.[^cli-runtime] To get those, `@effected/cli` takes
`@effected/engine` as a **regular dependency**.

It is a regular dependency and not a peer because engine carries no
shared-instance contract that a duplicate copy would break. Engine is pure
and has no `@effected` peers, so the edge adds nothing to cli's peer
closure. `Distribution` is a plain `Schema.Struct`, compared
structurally. `CurrentDistribution` is a `Context.Reference` keyed by the
string `"@effected/engine/CurrentDistribution"`,[^engine-distribution] and
core looks a service up by that key,[^core-context] so a value provided
through cli's copy is the value a consumer engine reads through its own.

## Alternatives rejected

- **Keep the wiring in each consumer.** Rejected: it is the duplicated
  recipe D1 exists to remove, and the recipe's usual shape replaced core's
  formatter instead of wrapping it, which drops the colour.
- **A peer dependency on `engine`.** Rejected: a peer is for a contract that
  must resolve to one copy, and this one does not. It would make every
  application declare a package it may never import.
- **Copy `CurrentDistribution` into cli.** Rejected: a second Reference with
  another key would split the value the program and its engine read, which
  is the bug the shared primitive exists to prevent.
- **An engine `distributionFormatter` that built a whole replacement
  `formatVersion`.** Tried on this branch and removed before release: it
  dropped a coloured or custom formatter. The decorator
  `withDistributionVersion(distribution)(formatVersion)` wraps the formatter
  in effect instead.

## Consequences

`@effected/cli`'s regular dependencies are `@effected/github-commands`,
`@effected/engine` and `@effected/commands` (the last for `./ui`'s chalk
resolution, see [the `./ui` Node licence](ui-binds-process-streams.md)).
A program must not also append the suffix in `env.formatter`, or it prints
twice. A hand-wired program that does not use `CliRuntime.main` composes
the same two engine exports itself. D1's rule still stands for every other
package: `@effected/mcp` (a peer) and `@effected/cli` are the only kit
dependents of `engine`.

[^owner-ruling]: conversation with the repository owner, 2026-10-26
[^cli-runtime]: `../../packages/cli/src/CliRuntime.ts`
[^engine-distribution]: `../../packages/engine/src/Distribution.ts`
[^core-context]: `../../.repos/effect/packages/effect/src/Context.ts`
