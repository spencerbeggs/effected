---
type: Consumer
title: spencerbeggs/okfit
description: The OKF v0.2 CLI, MCP server, and LSP for authoring and validating a knowledge bundle — the canonical carrier-pattern repo this kit's own bundle runs on.
repository: spencerbeggs/okfit
status: stable
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: 7f14a24d7bf398cb6b1f024c31e94b25f37c0ab4be20513634c05e6fb9c61a87
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
- [`@effected/cli`](../modules/cli.md)'s `./ui` screens, behind the
  optional peers `ink` and `react`: the `okfit init` wizard runs on
  `CliUi.fallback` (`packages/cli/src/internal/initWizard.ts`), a `Select` for
  the profile, a `TextInput` with an inline `validate` for the bundle
  directory and a `Select` for the config location, each with an `otherwise`
  default so a non-interactive run writes what the flags say and loads
  neither peer. The `okfit verify` picker runs `MultiSelect.screen` through
  `CliUi.prompt` with no `otherwise`, one section per concept type, then
  `Confirm.screen` with a toggle (`packages/cli/src/commands/verify-picker.ts`);
  declining raises `Cancelled` with reason `escape` and exits 130. Its tests
  drive the screens with `CliUiTest.session`, counting `mounts === 0` for the
  run that must not prompt.
- The presentation root around those screens: `CliEnv.layer` and
  `CliAudience` with an `OKFIT_AUDIENCE` override, `CliExit.set` in place of
  its own exit-code cell, and `FORCE_COLOR` honoured through
  [`@effected/env`](../modules/env.md).
- [`@effected/cli`](../modules/cli.md)'s `Doc` IR, as a **trial only**: its
  human `validate` report and `verify --all` batch lines were rebuilt as
  `Doc`s and compared byte for byte with the current renderers. They match in
  plain output; okfit is not adopting the IR.
- [`@effected/app`](../modules/app.md) — `AppConfig` only
  (`packages/engine/src/config/layer.ts`). `App`, `AppStore`, and
  `AppCache` are forbidden imports, enforced by a boundary test in both
  `packages/cli/__test__/utils/boundaries.ts` and
  `packages/engine/__test__/boundaries.test.ts` (K-9's forbidden-names
  list: `App`, `AppStore`, `AppCache`).
- [`@effected/xdg`](../modules/xdg.md) and
  [`@effected/config-file`](../modules/config-file.md)
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

- Whether the `Doc` IR can carry okfit's human output without workarounds:
  the trial's remaining asks are a `Doc.verbatim` with an indent, so an
  indented fragment (`would write:` and a frontmatter excerpt) survives
  `Render.markdown`, and a nullable link target that degrades to its label for
  a finding with no file. Until then okfit keeps its own renderers (colour is
  K-19: only the severity word is painted).
- Every `./ui` screen keeps its non-interactive answer byte-identical to the
  flag path: a screen reached with no terminal resolves `otherwise`, never
  a missing-flag error, and never loads `ink` or `react`.

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
- Shared bins, with an optional migration to
  [carrier-only bins](../decisions/carrier-only-declares-bins.md):
  `@okfit/cli`, `@okfit/lsp` and `@okfit/mcp` each declare the bin
  (`okfit`, `okfit-lsp`, `okfit-mcp`) that the carrier `@okfit/plugin`
  also declares, and the plugin loaders (`plugins/claude-code/bin/start-mcp.sh`,
  `start-lsp.sh`, pinned by `__test__/loader.bats` and `lsp-loader.bats`)
  fall back to `npx --yes @okfit/mcp` and `npx --yes @okfit/lsp`. Keeping
  that shape is supported: a `PackedInstall` proof passes
  `allowSharedBins: true` and accepts lost provenance under flat installs.
  Migrating, if okfit wants the identity to hold everywhere, is a major bump
  for each front end, with the loaders moving to
  `npx --yes -p @okfit/plugin@<MAJOR> okfit-mcp` in the same release.
