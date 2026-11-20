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
  - id: build-watch
    resource: ../../packages/engine/src/build/BuildWatch.ts
  - id: cli-watch
    resource: ../../packages/cli/src/commands/watch.ts
generated:
  by: "claude-code/sonnet-5.5"
  at: 2026-11-20T17:18:13Z
integrity:
  generated:
    body: 909c031258bb8315
---

# The effected build commands: package build, action build and action init

`effected package build` builds the package in the working directory into its `dist/prod`. `effected action build` builds the GitHub Action in the working directory into its `dist`, and `effected action init` scaffolds a new one for it to build. They are commands of the [effected tool](../decisions/one-tool-beside-the-libraries.md): the flags and exit codes live in [`@effected/cli`](../modules/cli.md), the logic in [`@effected/engine`](../modules/engine.md)'s `./build` subpath, and [`effected-mcp`](../modules/mcp.md) answers the same results as data. The config they read is [`effected.toml`](effected-toml.md), and what they leave on disk is [the build artifacts](build-artifacts.md).

```text
effected package build [--format=human|json] [--no-exe] [--verbose] [--watch]
effected action build [--format=human|json] [--no-validate] [--no-persist] [--watch]
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
| `--watch` | Rebuilds whenever a source file or `effected.toml` changes, until interrupted; see [Watching](#watching) |

- **Exit 1** is `BuildFailedError`: the build crashed, or it finished having recorded an error.
- **Exit 2** is `PackageConfigError`, carrying the engine's message, which names the file and key at fault: an `effected.toml` that will not load or decode, a plugin module that will not load, a directory with no readable `package.json`, or a config the bundler refuses before any work (`ConfigValidationError`).
- **Exit 3** is `PackageRunError` for a file that could not be read or written, or for another build of the same package that held [the build lock](build-artifacts.md#the-build-lock) for the whole five-minute wait, named in the message. A journal that cannot be appended to also lands on exit 3, through the runtime's fallback.[^build-run]

**Two builds of one package run one after the other.** While another build holds the lock, the command prints `waiting for another build of this package: process <pid>, building <cwd> since <time> (<lock file>)` on stderr and waits.

Under `--format=json`, stdout holds exactly one `BuildRunResult` (`package`, `verdict`, `issues`, `report`, `config.sources`) and the human lines go to the log. For the CI audience the build's diagnostics are also printed as workflow annotations, on stderr under `--format=json` so that stdout stays one document. When `GITHUB_STEP_SUMMARY` is set, the summary is appended; that belongs to the CLI, so a `package_build` over MCP inside an Actions step does not write it.[^package-execute]

## `effected action build`

| Flag | Effect |
| --- | --- |
| `--format=human\|json` | The report's form, as above |
| `--no-validate` | Skips validating the config and `action.yml`, and the bundle size check |
| `--no-persist` | Skips copying the build to the local action directory |
| `--check` | Builds to a staging directory and fails when the committed build differs; writes nothing |
| `--watch` | Rebuilds whenever a source file or `effected.toml` changes, until interrupted; see [Watching](#watching) |

An absent `[action]` table means the directory is a library, not an action, and the command refuses it.[^action-run]

- **Exit 1** is `ActionBuildFailedError`: validation stopped the build, an entry failed to bundle or to load, or `--check` found drift. In strict mode a warning fails like an error. `[action.validation] strict` sets that mode, and when it is absent CI turns it on.[^action-builder]
- **Exit 2** is `ActionConfigError`: an `effected.toml` that will not load, no `[action]` table, a directory with no readable `package.json`, or a `[action.persistLocal]` path that is refused (see [the table](effected-toml.md#action)).
- **Exit 3** is `ActionRunError`: an entry that is missing with validation off, or a file that could not be read, cleaned, written or copied.
- **Exit 64** is a usage error: `--check` with `--watch`, `--check` with `--no-persist`, `--check` when persisting is disabled, or `--no-persist` when `dist = false` leaves the build no output.

Under `--format=json`, stdout holds one `ActionRunResult` (`verdict`, `result`), where `result` carries `validation`, `build` and `persisted`. When validation stops the build before bundling, `build` has no entries and `success: false`. The step summary is appended as above; this command prints no workflow annotations.[^action-execute]

**The command persists by default.** Unless `--no-persist` or `[action.persistLocal] enabled = false` says otherwise, a successful build also writes `.github/actions/local`, and `.actrc` and `.github/workflows/act-test.yml` when those two do not exist. A failed build or size check persists nothing, and an invalid action leaves `dist` as it was.[^action-builder]

**The persisted directory follows `[action.persistLocal]`.** Under `base = "workspace"` it is `.github/actions/<package directory basename>` at the workspace root, and with `dist = false` the bundles are staged in `<package>/.action-staging`, which is removed after every build, so the package keeps no `dist/`.

**`--check` compares and writes nothing.** It stages a build, then compares `action.yml` and `dist/**` byte for byte against the persisted directory, and against the package `dist/` when the package keeps one. Each difference is reported as `<target>: <kind> <path>`, where the kind is `changed`, `missing` or `extra`. Any drift is exit 1 and a match is exit 0. Under `--format=json` the drift is `result.drift`. A check always compares against the persisted build, so it does not combine with `--no-persist`.

**The load check runs what it built.** Unless `[action.build] importCheck = false`, each bundle is imported in a fresh Node to prove it loads, which runs an action with no `GITHUB_ACTIONS` guard around its program for real. A worker that refuses to start at import by design sets `importCheck = false` in its own `[action.entries.workers.<name>]` table, which skips that bundle alone.

An action build appends to no journal; the journals record package builds only.

## Watching

`--watch` behaves the same on both build commands. It builds once, then again after each settled batch of changes, until it is interrupted. Every run is a full build, not an incremental one. For a package build that keeps `dist/prod/issues.json` and the root journals current exactly as one-shot runs keep them; an action build writes neither, as above.[^build-watch]

- **What is watched.** The package directory's top level, and each top-level directory no exclusion covers, recursively. An excluded `node_modules`, `.git` or `dist` is never walked, so a single-package repository with a populated `node_modules` starts at once and does not spend the host's watch limit. A directory that is only where an exclusion lives, such as `.github`, is watched, and the filter below drops the build's own events in it. A new top-level directory is watched from its first event, and its creation is itself a change; a removed one's watch is dropped, which is not the watcher stopping. A directory's watch that ends while the directory it watched is still there is the watcher stopping; a directory replaced at the same path counts as removed. When the package is not the workspace root, the root tier is watched too: `<root>` and `<root>/.config`, each non-recursively and filtered to `effected.toml`. Watching the directory rather than the file catches a file that does not exist yet and an editor's save-by-rename. A `<root>/.config` that does not exist when the watch starts is watched once it is created. Creating, removing or replacing `<root>/.config` is a change to its `effected.toml`, and each moves the watch to whatever directory is there now, so a replaced one is not left on the old directory. Some inputs outside the package are never watched: [editing them does not rebuild](../limitations/watch-ignores-inputs-outside-the-package.md).
- **What is excluded.** These paths are package-relative and matched on `/` boundaries: `dist`, `node_modules`, `.turbo`, `.git`, `.cache`, `tsdoc.json`, `.actrc`, `.github/workflows/act-test.yml`, `.github/actions/local` and `.action-staging`. An exclusion covers the path, everything under it, and the directories it lives in.
  - A path that only shares a prefix with an exclusion still triggers: `distribution/x.ts` does, and so does `.github/actions/local-notes.md`.
  - A file beside an excluded path also triggers, such as `.github/workflows/ci.yml`. A bare `.github` or `.github/workflows` directory event does not, because those are the directories a first action build creates on its way to its own outputs.
  - An action watch also excludes its persisted directory, resolved from `persistLocal` with the same `base` rule as the build and re-read from `effected.toml` before each batch. An edit that moves the path or turns persist off is honoured. Under `--no-persist` the build writes nothing there, so the path stays watched. The default `.github/actions/local` is always excluded, so a config that will not load cannot start a loop.
  - A package watch also excludes each `[package.build.meta] localPaths` directory inside the package, re-read from `effected.toml` before each batch, because every build copies the API model into each one. A `localPaths` entry outside the package needs no exclusion: nothing outside the package is watched.
- **Debounce and queueing.** Events collect until the tree has been quiet for 100 ms, then run as one batch, so a branch switch or a format-on-save is one rebuild. Changes made during a build are kept, not dropped, and become exactly one follow-up run. Builds never overlap.
- **Before each rebuild** the command prints `rebuilding: <path>, <path>, <path>` on stderr, followed by `+N more` when there are more than three paths. The paths are relative to the package, and a root-tier config reads as `../…`. Each path is printed as data: escape sequences and control characters are stripped, and a line break becomes a space.
- **A broken edit does not end the watch.** A failed verdict, a config or plugin that will not load, or a run that could not finish is reported the way a one-shot run reports it, and the watch waits for the next change. A plugin written as native `.mjs`, or `.js` under `type: module`, is cached by Node's ESM loader, so a fixed one is not seen until the watch restarts. The report of a run that built goes to stdout; a refusal or a run failure is rendered on stderr and puts nothing on stdout. A failure that arrives alongside an interrupt from inside a build is reported, and the watch goes on.[^cli-watch]
- **Exit 2 before any watch exists** when the directory itself is wrong: no `package.json`, no `[action]` table, or workspace discovery that fails (a workspace file that will not read or parse; no workspace above the package is not a failure, and makes the package its own root). A config that will not load, or cannot be read, is an edit the watch must survive, so the watch starts.
- **Exit 3** when the package directory's own watch or a root-tier watch fails or stops, or a top-level directory's watch fails while the directory is still there, rendered as `PackageRunError` or `ActionRunError`. A watch never sits idle looking healthy.
- **Exit 130** on Ctrl-C. The build in flight is interrupted, and a package build releases [the build lock](build-artifacts.md#the-build-lock); an action build takes no lock.
- **Exit 64 under CI.** `--watch` is a usage error for the CI audience, because a watching job never ends.
- **Under `--format=json`, stdout is JSON Lines:** one `BuildRunResult` or `ActionRunResult` per run.
- **No step summary and no workflow annotations** are written while watching.

## `effected action init`

It writes a new action to [the canonical shape](../conventions/github-action-canon.md), ready for `effected action build`: `effected.toml` opening with the `#:schema` directive that points TOML editors at [its JSON Schema](effected-toml.md#json-schema), then `[action.entries] main` and `[action.persistLocal]` enabled, `action.yml` (`node24`, `runs.main` at `dist/main.js`, branding), `src/main.ts` (the program import and the `GITHUB_ACTIONS` guard), `src/program.ts`, and a `tsconfig.json` that extends `@effected/plugin/tsconfig/action.json`. With `--local` the `[action.persistLocal]` table is `base = "workspace"` and `dist = false` instead, and a `.gitignore` listing `dist/` and `.action-staging/` is written when the package has none. It has a `main` phase only and needs no token; `pre`, `post` and App authentication are added when the action needs them.[^action-init]

| Flag | Effect |
| --- | --- |
| `--format=human\|json` | The report's form, as above |
| `--name` | The display name in `action.yml`. Omitted, `package.json`'s `name` without its scope |
| `--description` | The description in `action.yml`. Omitted, `package.json`'s `description` |
| `--local` | Scaffolds a local-only action: persists to the workspace root and keeps no package `dist/` |
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
| `action_build` | `cwd?`, `validate?` (default `true`), `persist?` (default `false`), `check?` (default `false`; ignores `persist`) | `ActionRunResult` |
| `action_init` | `cwd?`, `name?`, `description?`, `local?` (default `false`), `force?` (default `false`) | `ActionInitResult` |

- **`action_build` never persists unless asked,** the opposite of the command's default. Only `persist: true` writes `.github/actions/local`, `.actrc` and `.github/workflows/act-test.yml`; otherwise it writes only `dist`.[^action-tool]
- **`action_init` has no verdict.** It answers what it wrote. Everything exit 2 or 3 covers above is a refusal: an existing file without `force`, a conflict (a symbolic link, the wrong kind of entry), no `package.json`, or a missing or invalid name or description. The containment check covers `cwd`; within it, the command's own rule keeps every write inside `cwd`, so a committed link cannot carry a write past the workspace root. It takes no lane, because it writes sources and never `dist`.[^action-tool]
- **Builds are serialized.** Both build tools take one shared lane with a 10-minute timeout. The timeout cannot stop a build, because the bundler's passes are promises nothing can abort: a timed-out build runs on while the next call holds the lane, and the refusal says to wait.[^package-tool] Across processes, `package_build` also waits on [the build lock](build-artifacts.md#the-build-lock), so a call racing a terminal's build of the same package waits for it, and a wait that runs out is a refusal naming the lock file.
- **The build tools are one-shot.** Neither takes a `watch` parameter; a watch belongs to the command, whose process a person or an agent can interrupt.
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
[^build-watch]: `packages/engine/src/build/BuildWatch.ts`: the watch set, the exclusions, the debounce and the follow-up run.
[^cli-watch]: `packages/cli/src/commands/watch.ts`: the status line, the CI refusal and how a failed run is rendered without ending the watch.
