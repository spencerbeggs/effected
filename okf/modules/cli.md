---
type: Module
title: "@effected/cli"
description: "The effected command: effected package build, effected action build and effected schema build, check and validate over effect/cli and @effected/cli-kit, with --version and --help, run by a bin that a carrier shim can wrap with its own distribution identity."
status: draft
kind: package
resource: ../../packages/cli
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T22:24:55Z
integrity:
  generated:
    body: c670d5165b94411c
---

# @effected/cli

`@effected/cli` is the `effected` command, a front end of the [effected tool](../decisions/one-tool-beside-the-libraries.md). It is an application package with no library tier. A consumer installs [`@effected/plugin`](plugin.md), not this package; the CLI presentation library is [`@effected/cli-kit`](cli-kit.md) ([the rename](../decisions/carrier-libraries-take-kit-names.md)).

## Surface

- `makeRootCommand(deps)`: the command tree, closed over the process boundary it runs against. It answers `--version`, `--help`, the shared audience flags (`--human`, `--agent`, `--ci`) and three subcommands, `package`, `action` and `schema`.
- `effected schema build|check|validate`: the schemastore commands. Their flags, drift policy, exit codes, catalog and reports are [the schema commands' contract](../interfaces/schema-commands.md), carried over from the companion package they replaced with `--ignore-version-mismatch` and a line diff added ([why they are here](../decisions/schema-commands-live-in-the-tool.md)). This package owns what a front end owns: the flags, every exit code (the engine answers verdicts as data), the `--force` and version-mismatch warnings, the step-summary append, and the drawing.
- `effected package build` and `effected action build`: [the build commands' contract](../interfaces/build-commands.md). As with `schema`, this package owns the flags, every exit code, the annotations, the step-summary append and the drawing. The engine's build entry is imported only when the command runs, so `--version` and `schema` never load the bundler's toolchain.
- The live per-schema progress view is the only code that imports Ink, React or `@effected/cli-kit/ui`, and it is reached by dynamic import, only for human output on an interactive run. An agent, CI or piped run never loads them, which a built-bin test pins.
- `main(options?)`: runs the program on the Node services under `CliRuntime.main`; `options.distribution` is the carrier the bin was installed through, which appends `via <name> <version>` to `--version`.
- `run`: the same program over a supplied platform layer, so tests drive it in-process over `@effected/memfs`.
- `CLI_VERSION`: the package's own version, replaced at build. The typed errors a run ends with (`DriftError`, `GateError`, `StaleError`, `CatalogMergeError`, `ValidationFailedError`, `NoConfigError`, `BuildFailedError`, `PackageConfigError`, `PackageRunError`, `ActionBuildFailedError`, `ActionConfigError`, `ActionRunError`) are exported.

## Boundaries

- The `effected` bin is declared here and again by the carrier, a [supported shared-bin choice](../decisions/carrier-only-declares-bins.md): the agent plugin's one-off fallback runs a front end, and a one-off runner cannot choose between two bins of one package.
- Shared logic belongs in [engine](engine.md): this package holds `@effected/engine` as a `workspace:*` dependency, published exact ([the pin chain](../conventions/peer-dependency-discipline.md#cross-effected-dependencies)). It reaches [the bundler](bundler.md) only through the engine.
- `typescript` is a peer at the literal range [the carrier](plugin.md#boundaries) records, nightlies excluded, and the tsconfig presets ship from the carrier rather than here.
