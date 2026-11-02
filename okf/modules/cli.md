---
type: Module
title: "@effected/cli"
description: "The effected command: --version and --help over effect/cli and @effected/cli-kit, run by a bin that a carrier shim can wrap with its own distribution identity."
status: draft
kind: package
resource: ../../packages/cli
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T16:44:32Z
integrity:
  generated:
    body: d58b8e842206e5ab
---

# @effected/cli

`@effected/cli` is the `effected` command, a front end of the [effected tool](../decisions/one-tool-beside-the-libraries.md). It is an application package with no library tier. A consumer installs [`@effected/plugin`](plugin.md), not this package; the CLI presentation library is [`@effected/cli-kit`](cli-kit.md) ([the rename](../decisions/carrier-libraries-take-kit-names.md)).

## Surface

- `rootCommand`: the command tree. This release answers `--version` and `--help` (plus the `effect/cli` built-ins) and nothing else.
- `main(options?)`: runs the program on the Node services under `CliRuntime.main`; `options.distribution` is the carrier the bin was installed through, which appends `via <name> <version>` to `--version`.
- `run`: the same program over a supplied platform layer, so tests drive it in-process over `@effected/memfs`.
- `CLI_VERSION`: the package's own version, replaced at build.

## Boundaries

- The `effected` bin is declared here and again by the carrier, a [supported shared-bin choice](../decisions/carrier-only-declares-bins.md): the agent plugin's one-off fallback runs a front end, and a one-off runner cannot choose between two bins of one package.
- Shared logic belongs in [engine](engine.md).
