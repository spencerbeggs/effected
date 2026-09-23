---
type: Consumer
title: spencerbeggs/okfit
description: The OKF v0.2 CLI, MCP server, and LSP for authoring and validating a knowledge bundle — the canonical carrier-pattern repo this kit's own bundle runs on.
repository: spencerbeggs/okfit
status: stable
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:36:08Z
  body_sha256: 8ef39757137aed03619e015b6bfe477154e07e98deadca6281af8b8427c55b8b
---

# spencerbeggs/okfit

`spencerbeggs/okfit` is the OKF v0.2 tooling this repository's own `okf/`
bundle runs on: a config-driven bundle validator, index/log synchronizer,
CLI, MCP server, and (in progress) LSP. Verified against the checkout at
`/Users/spencer/workspaces/spencerbeggs/okfit`, 2026-09-23.

It is this register's canonical **carrier-pattern** repo: a monorepo of
`@okfit/{core,profiles,engine,cli,mcp,lsp,plugin}` packages, with every
edge pointing down. `core` and `profiles` hold the codec and vocabulary;
`engine` composes them into shared programs; `cli`, `mcp`, and `lsp` are
three thin front ends over `engine`; `plugin` distributes the Claude Code
integration. No front end depends on another front end.

## What it exercises

- [`@effected/cli`](../modules/cli.md) — `CliRuntime.reportFailures`
  (`packages/cli/src/main.ts`), `CliLogger` (provided outermost around the
  reporting layer, also in `main.ts`), and `ConfigIssueRenderer`
  (`packages/cli/src/errors.ts`) for rendering a validation error's
  `render` option one line per stderr line.
- `@effected/app` — `AppConfig` only (`packages/engine/src/config/layer.ts`).
  `App`, `AppStore`, and `AppCache` are forbidden imports, enforced by a
  boundary test in both `packages/cli/__test__/utils/boundaries.ts` and
  `packages/engine/__test__/boundaries.test.ts` (K-9's forbidden-names
  list: `App`, `AppStore`, `AppCache`).
- `@effected/xdg` and [`@effected/config-file`](../modules/config-file.md)
  (`TomlCodec`) for config discovery and parsing,
  [`@effected/schemastore`](../modules/schemastore.md) (`HostedSchema`) for
  the published config JSON Schema, and `@effected/schemastore-cli`.
- [`@effected/commands`](../modules/commands.md) — `Run.collect` in its
  e2e suites.

## What it keeps for itself

- Its own exit-code order: `130 > 64 > 3 > 2 > 1 > 0` — signal interrupt
  outranks usage error, which outranks the rest, and the ordering itself
  is `okfit`'s policy rather than a kit contract.
- Its envelope schemas — the `--format json` payload shapes for each
  subcommand.
- Its LSP (`packages/lsp`), which nothing in the kit's `cli` package
  addresses.

## Open questions it holds the kit to

- A `Distribution` reference below the front ends — worth a
  `@effected/engine` package, since `okfit`'s own `engine` package is
  exactly the shape a kit `Distribution` primitive would sit under.
- A `ShowHelp`-safe `reportFailures` — `CliRuntime.reportFailures`'s
  default render calls `String(value)` on a raised `ShowHelp`, and
  `Command.runWith` already rendered the help text and re-fails with the
  same `ShowHelp`, so `errors.ts` carries a workaround for the resulting
  stray "Help requested" line.
- A findings exit code that survives teardown — validation findings need
  a stable exit code distinct from a crash, past `NodeRuntime.runMain`'s
  teardown.
- A colour rule — its own bug: `NO_COLOR !== "1"` is checked instead of
  presence, so `NO_COLOR=""` or any other truthy-looking value fails to
  disable colour the way `NO_COLOR` being merely *set* should.
- MCP primitives — `Remediation`/`ToolFailure`, `ToolInputSchema`, and
  `LaunchContext` belong in a future `@effected/mcp` (phase 2); okfit's
  own MCP remediation helpers are one of three near-identical copies
  across the kit's consumers.
