---
type: Interface
title: "The effected build commands: package build, action build and action init"
description: "The contract of effected package build, effected action build and effected action init and their MCP tools package_build, action_build and action_init: the flags, the exit codes, what each writes, and the rule that a failed build is a verdict carried as data while a run that could not start or finish is an error or a refusal."
status: draft
kind: cli
resource: ../../packages/cli/src/commands/package
tags:
  - dx
  - ci
  - release
sources:
  - id: package-execute
    resource: ../../packages/cli/src/commands/package/execute.ts
  - id: action-execute
    resource: ../../packages/cli/src/commands/action/execute.ts
  - id: build-run
    resource: ../../packages/engine/src/build/BuildRun.ts
  - id: action-run
    resource: ../../packages/engine/src/build/ActionRun.ts
  - id: package-tool
    resource: ../../packages/mcp/src/tools/package.ts
  - id: action-tool
    resource: ../../packages/mcp/src/tools/action.ts
  - id: action-init
    resource: ../../packages/engine/src/build/ActionInit.ts
  - id: action-init-execute
    resource: ../../packages/cli/src/commands/action/execute-init.ts
  - id: action-builder
    resource: ../../packages/bundler/src/action/ActionBuilder.ts
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-08T17:37:31Z
integrity:
  generated:
    body: 373bf777990e3ae6
---

# The effected build commands: package build, action build and action init

`effected package build` builds the package in the working directory into its `dist/prod`. `effected action build` builds the GitHub Action in the working directory into its `dist`, and `effected action init` scaffolds a new one for it to build. They are commands of the [effected tool](../decisions/one-tool-beside-the-libraries.md): the flags and exit codes live in [`@effected/cli`](../modules/cli.md), the logic in [`@effected/engine`](../modules/engine.md)'s `./build` subpath, and [`effected-mcp`](../modules/mcp.md) answers the same results as data. The config they read is [`effected.toml`](effected-toml.md), and what they leave on disk is [the build artifacts](build-artifacts.md).

```text
effected package build [--format=human|json] [--no-exe] [--verbose]
effected action build [--format=human|json] [--no-validate] [--no-persist]
effected action init [--format=human|json] [--name=<name>] [--description=<text>] [--force]
```

Neither takes a path. The working directory is the package; in this repository run the first through `pnpm build --filter <pkg>`, because [turbo holds the typecheck gate and the cache](../conventions/build-through-turbo-only.md).

## The rule both commands follow

**A build that ran and failed is a verdict, and a run that could not start or finish is an error.** The engine answers `verdict: "ok" | "failed"` for every build that ran, so a front end can always show what happened. The report is emitted first and the failure follows, so a failing run has already said why.[^package-execute]

| code | meaning |
| --- | --- |
| 0 | the build succeeded |
| 1 | it ran and found a problem: the verdict `failed` |
| 2 | it could not start: the config or the directory is at fault |
| 3 | it could not finish: an infrastructure failure |
| 64 | a usage error |

## `effected package build`

| Flag | Effect |
| --- | --- |
| `--format=human\|json` | The report's form. The default follows the audience, as `effected schema`'s does |
| `--no-exe` | Skips the single-executable compile, which is the only skip: without it the binary compiles on any host, for its declared target. The manifest still points at the binary |
| `--verbose` | Measures gzip sizes for the report |

- **Exit 1** is `BuildFailedError`: the build crashed, or it finished having recorded an error.
- **Exit 2** is `PackageConfigError`, carrying the engine's message, which names the file and key at fault: an `effected.toml` that will not load or decode, a plugin module that will not load, a directory with no readable `package.json`, or a config the bundler refuses before any work (`ConfigValidationError`).
- **Exit 3** is `PackageRunError` for a file that could not be read or written. A journal that cannot be appended to also lands on exit 3, through the runtime's fallback.[^build-run]

Under `--format=json`, stdout holds exactly one `BuildRunResult` (`package`, `verdict`, `issues`, `report`, `config.sources`) and the human lines go to the log. For the CI audience the build's diagnostics are also printed as workflow annotations, on stderr under `--format=json` so that stdout stays one document. When `GITHUB_STEP_SUMMARY` is set, the summary is appended; that belongs to the CLI, so a `package_build` over MCP inside an Actions step does not write it.[^package-execute]

## `effected action build`

| Flag | Effect |
| --- | --- |
| `--format=human\|json` | The report's form, as above |
| `--no-validate` | Skips validating the config and `action.yml`, and the bundle size check |
| `--no-persist` | Skips copying the build to the local action directory |

An absent `[action]` table means the directory is a library, not an action, and the command refuses it.[^action-run]

- **Exit 1** is `ActionBuildFailedError`: validation stopped the build, or an entry failed to bundle or to load. In strict mode a warning fails like an error. `[action.validation] strict` sets that mode, and when it is absent CI turns it on.[^action-builder]
- **Exit 2** is `ActionConfigError`: an `effected.toml` that will not load, no `[action]` table, or a directory with no readable `package.json`.
- **Exit 3** is `ActionRunError`: an entry that is missing with validation off, or a file that could not be read, cleaned, written or copied.

Under `--format=json`, stdout holds one `ActionRunResult` (`verdict`, `result`), where `result` carries `validation`, `build` and `persisted`. When validation stops the build before bundling, `build` has no entries and `success: false`. The step summary is appended as above; this command prints no workflow annotations.[^action-execute]

**The command persists by default.** Unless `--no-persist` or `[action.persistLocal] enabled = false` says otherwise, a successful build also writes `.github/actions/local`, and `.actrc` and `.github/workflows/act-test.yml` when those two do not exist. A failed build or size check persists nothing, and an invalid action leaves `dist` as it was.[^action-builder]

**The load check runs what it built.** Unless `[action.build] importCheck = false`, each bundle is imported in a fresh Node to prove it loads, which runs an action with no `GITHUB_ACTIONS` guard around its program for real.

An action build appends to no journal; the journals record package builds only.

## `effected action init`

It writes a new action to [the canonical shape](../conventions/github-action-canon.md), ready for `effected action build`: `effected.toml` with `[action.entries] main` and `[action.persistLocal]` enabled, `action.yml` (`node24`, `runs.main` at `dist/main.js`, branding), `src/main.ts` (the program import and the `GITHUB_ACTIONS` guard), `src/program.ts`, and a `tsconfig.json` that extends `@effected/plugin/tsconfig/ecma.json`. It has a `main` phase only and needs no token; `pre`, `post` and App authentication are added when the action needs them.[^action-init]

| Flag | Effect |
| --- | --- |
| `--format=human\|json` | The report's form, as above |
| `--name` | The display name in `action.yml`. Omitted, `package.json`'s `name` without its scope |
| `--description` | The description in `action.yml`. Omitted, `package.json`'s `description` |
| `--force` | Replaces regular files that exist. It never replaces or follows a symbolic link, and never overrides a conflict |

- **Every path is inspected before anything is written,** with `lstat`, so a refusal writes nothing. Each file and each directory the files go into is checked, and every conflict is named at once.
- **It never writes outside the directory it runs in through a link it was given.** A symbolic link at a file it writes, or at a directory it writes into (`src`), is a conflict, with or without `--force`. Such a link is never followed and never replaced, even when it dangles. So are:
  - a directory where a file goes, and a file where a directory goes;
  - an entry that cannot be inspected;
  - an existing file it may not write, or an existing directory it may not write into, the run's own directory included (named `.`);
  - an entry whose name differs only in case (`Action.yml` for `action.yml`), which is the same entry on a case-insensitive filesystem.
- **Just before each file is written,** the directories on its path are inspected again and the target is confirmed to resolve inside the directory, and the file is written with a link at its own path replaced rather than followed. That is a point-in-time check. A committed link cannot get past it, because the first pass refuses them all, but a concurrent local writer could swap a directory for a link between the check and the write. Past the first such check, a failure stops the run with exit 3, naming the files already written.
- **It refuses to overwrite.** Without `--force`, an existing regular file stops the run with nothing written, naming every such file. With it, those files are replaced, each atomically.
- **The name and description are one line of printable text.** A C0 control other than TAB (a newline included), DEL, a C1 control or a lone surrogate is refused, naming the field and the character. What remains is written as a YAML double-quoted scalar.
- **It edits no `package.json`.** The report names the packages the scaffold needs that the manifest's `dependencies` and `devDependencies` do not declare; a peer does not count, since it installs nothing. They are `@effected/github-actions`, `effect` and its peer `@effect/platform-node`; and as devDependencies `@effected/plugin`, which `effected` and the tsconfig preset come from, and its peers `typescript` and `@types/node`, which the preset's `types: ["node"]` needs. The report also says whether `"type": "module"` is set, which the entry's top-level `await` needs. The build cannot bundle until they are installed: it reads the preset.
- **Exit 0** is a scaffold written. **Exit 2** is `ActionInitError`: no readable `package.json`, a name or description given nowhere or holding a control character, an existing file without `--force`, or a conflict. **Exit 3** is `ActionRunError`: a write failed after every check passed, and the message names the path and the files already written.[^action-init-execute]

Under `--format=json`, stdout holds one `ActionInitResult` (`cwd`, `written`, `overwritten`, `missingDependencies`, `missingDevDependencies`, `typeModule`).

## The MCP tools

The tools resolve `cwd` against the workspace root, refuse a `cwd` outside it once links are resolved, reload the config on every call, and declare the same classes the CLI's JSON encodes. They have no exit codes: exits 1 and 0 arrive as the result's `verdict`, and what would be exit 2 or 3 is a `ToolRefusal` whose hint names the path to look at.[^package-tool]

| Tool | Parameters | Answers |
| --- | --- | --- |
| `package_build` | `cwd?`, `noExe?` | `BuildRunResult` |
| `action_build` | `cwd?`, `validate?` (default `true`), `persist?` (default `false`) | `ActionRunResult` |
| `action_init` | `cwd?`, `name?`, `description?`, `force?` (default `false`) | `ActionInitResult` |

- **`action_build` never persists unless asked,** the opposite of the command's default. Only `persist: true` writes `.github/actions/local`, `.actrc` and `.github/workflows/act-test.yml`; otherwise it writes only `dist`.[^action-tool]
- **`action_init` has no verdict.** It answers what it wrote. Everything exit 2 or 3 covers above is a refusal: an existing file without `force`, a conflict (a symbolic link, the wrong kind of entry), no `package.json`, or a missing or invalid name or description. The containment check covers `cwd`; within it, the command's own rule keeps every write inside `cwd`, so a committed link cannot carry a write past the workspace root. It takes no lane, because it writes sources and never `dist`.[^action-tool]
- **Builds are serialized.** Both build tools take one shared lane with a 10-minute timeout. The timeout cannot stop a build, because the bundler's passes are promises nothing can abort: a timed-out build runs on while the next call holds the lane, and the refusal says to wait.[^package-tool]
- **A plugin cannot write the wire.** A plugin and the build tools run in the server's process, so a call runs with its stdout off the JSON-RPC stream.

[^package-execute]: `packages/cli/src/commands/package/execute.ts`: the report, the annotations, the step summary and every exit code.
[^build-run]: `packages/engine/src/build/BuildRun.ts`: what is a verdict and what stays in the error channel.
[^action-run]: `packages/engine/src/build/ActionRun.ts`: `NotAnActionError` and the partial result a failure stops with.
[^action-execute]: `packages/cli/src/commands/action/execute.ts`: the report, the step summary and every exit code.
[^action-init]: `packages/engine/src/build/ActionInit.ts`: the files, the refusal, and what `package.json` supplies.
[^action-init-execute]: `packages/cli/src/commands/action/execute-init.ts`: the report and every exit code.
[^action-builder]: `packages/bundler/src/action/ActionBuilder.ts`: the step order, strict mode, and what a failed step leaves behind.
[^package-tool]: `packages/mcp/src/tools/package.ts`: the parameters, the lane, the timeout and the refusals.
[^action-tool]: `packages/mcp/src/tools/action.ts`: the `persist` default and the refusals.
