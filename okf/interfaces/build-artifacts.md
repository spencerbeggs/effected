---
type: Interface
title: "The build artifacts: dist/prod, targets.json, issues.json and the journals"
description: "The on-disk contract of an effected build and who reads each part: dist/prod/<group>/{pkg,meta} for the release action, tsdoctor and the construct generator; targets.json; issues.json, whose buildOk a reader checks first; the append-only .cache/effected journals keyed by package; the __PACKAGE_VERSION__ define; and an action's dist bundles."
status: draft
kind: wire
resource: ../../packages/bundler/src/Bundler.ts
tags:
  - observability
  - release
  - ci
sources:
  - id: bundler
    resource: ../../packages/bundler/src/Bundler.ts
  - id: issues
    resource: ../../packages/bundler/src/report/issues-artifact.ts
  - id: targets-binding
    resource: ../../packages/bundler/src/targets/binding.ts
  - id: targets-config
    resource: ../../packages/bundler/src/targets/config.ts
  - id: journal
    resource: ../../packages/bundler/src/journal/BuildJournal.ts
  - id: generate
    resource: ../../packages/bundler/src/meta/generate.ts
  - id: action-bundle
    resource: ../../packages/bundler/src/action/ActionBundle.ts
  - id: build-run
    resource: ../../packages/engine/src/build/BuildRun.ts
  - id: build-lock
    resource: ../../packages/engine/src/build/BuildLock.ts
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-10T21:32:36Z
integrity:
  generated:
    body: 33178887b7fbbf76
---

# The build artifacts: dist/prod, targets.json, issues.json and the journals

An [`effected package build`](build-commands.md) leaves these on disk. Tools outside this repository read them, so a change to one moves with its readers. [The single target](../decisions/one-build-target-from-source-links.md) is why there is one tree, and [the journals Decision](../decisions/build-logs-are-journals.md) is why the logs sit apart from it.

```text
<package>/dist/prod/
  <group>/pkg/           what is packed and published
  <group>/meta/          <unscoped>.api.json, package.json, tsconfig.json, and maybe bundle.json and og/
  targets.json
  issues.json
<root>/.cache/effected/
  build.jsonl
  issues.jsonl
```

| Output | Read by |
| --- | --- |
| `<group>/pkg` | `silk-release-action`, which packs it; `PackedInstall` and the scratchpad's artifact mode; a plain-Node workspace consumer through [the `effected-built` condition](effected-toml.md#linking-built-output-to-a-plain-node-consumer) |
| `<group>/meta` | `silk-release-action`; [tsdoctor](../consumers/tsdoctor.md), for `bundle.json` and the API model; `plugin/scripts/generate-constructs.mts`, for the API model |
| `targets.json` | `silk-release-action` |
| `issues.json` | every gate, the silk `tsdoc-diagnostics` monitor and the `tsdoctor` agent |
| the journals | agent watchers |

## `<group>/pkg` and `<group>/meta`

A group is one distinct published name, from `publishConfig.targets`; with none declared there is one group, `npm`.[^bundler] `pkg` holds the JS, the declarations, the emitted `package.json` and, for an `exe` build, `bin/<binary>`, compiled whatever the host: `@tsdown/exe` cross-compiles. Its `exports["."]` points at the binary, and it has a `bin` only when the source manifest declares one. Declaration source maps are stripped from it. A `dist/prod/<group>/pkg` is also what a consumer's `bundledPackages` reads when it names this package as a sibling. A source export naming a file here under `effected-built` is a path into this tree, so moving an emitted file moves that consumer's target, and the build warns `exports-built-condition-unmatched` when the two disagree.

`meta` holds three files every time it exists: `<unscoped>.api.json`, the final `package.json` and a portable `tsconfig.json`. **`bundle.json` and `og/` are conditional, and a build removes a previous build's copies first,** so a package that stops producing them stops advertising them; it also deletes a leftover `tsdoctor.json`, the sidecar's former name, and never writes one.[^generate] There is no `meta` at all under `meta = false`, under `emitDts = false`, or for an exe-only package. `bundle.json` is decoded by readers outside this repository, and its fields grow additively.

## `targets.json`

`{ groups, targets }`: each group is `{ id, name, dir }`, and each target `{ id, group, name, registry, releases, provenance? }`, with `releases` always written and `all` when undeclared.[^targets-config] It is written after the JS and declaration passes, so a build that fails earlier leaves none of its own.[^targets-binding]

## `issues.json`

**A reader checks `buildOk` first and never `errors.length`.** A crashed build can leave every bucket empty, which would otherwise be identical to a clean gate. An artifact with no `buildOk` is unknown rather than a pass, and it does not decode against `BuildIssuesSchema`.[^issues]

```text
{ generatedAt, package, target, buildOk, failure?, warnings, errors, suppressed }
```

- `failure` is `{ name?, message }`, present only when `buildOk` is false, with `message` truncated to 2000 characters.
- Each diagnostic is `{ source, level, text, code?, ciFatal?, file?, line?, column? }`, de-duplicated across groups. `source` is `tsdown`, `rolldown`, `api-extractor`, `meta` or `config`. `ciFatal: true` marks a warning that is an error under CI.
- `target` is `prod` from this build. The schema still admits `dev`.
- **It is written on both terminal paths,** success and failure, by atomic rename, so a concurrent reader sees the previous artifact or the whole new one.
- **Freshness is a timestamp.** `generatedAt` must postdate your last source edit, because [a turbo cache hit replays a clean log](../gotchas/turbo-cache-hit-replays-clean-log.md) and restores this file with it. A failed artifact write is swallowed so that it cannot mask the build's outcome, and the engine therefore never trusts a file stamped before the build started: it rebuilds the answer as `buildOk: false`.[^build-run]

## The journals

`build.jsonl` and `issues.jsonl` sit under the workspace root, are append-only, are written with [`@effected/jsonl`](jsonl-journal.md), and carry the package name as each line's `scope`. They are a watcher's view, at one guessable path. `issues.json` stays what a reader trusts for one package's result.[^journal]

| Journal | Event | One line per | Data |
| --- | --- | --- | --- |
| `issues.jsonl` | `issue` | error and warning, in that order | `package`, `generatedAt`, and the diagnostic's fields |
| `build.jsonl` | `build` | finished build | `package`, `cwd`, `generatedAt`, `buildOk`, `failure?`, `errors`, `warnings`, `suppressed`, `issuesPath` |

- **The build's line goes last,** so a watcher that sees it finds that build's issues already written.
- Suppressed diagnostics stay in `issues.json` and are only counted on the build's line.
- Parallel builds may record at once: each line is one `O_APPEND` write.
- **A cache hit adds no line,** since no build ran. A run refused before the build finishes, such as a config failing `ConfigValidationError`, adds none either, and neither does an action build.

The engine records these after the bundler returns, not the bundler itself, and a journal that cannot be appended to fails the run.[^build-run]

## The build lock

**One build of a package runs at a time in a tree.** A build holds `<root>/.cache/effected/locks/<name>.lock` from before the bundler cleans `dist/prod` until the journals have its answer, so a second build of the same package waits rather than cleaning and writing the same `dist/prod` underneath the first. Without it, a test's setup build racing a turbo build can leave one build's crash in `issues.json` after the other has exited 0, and turbo caches that `dist` under the pass.[^build-lock]

- `<name>` is the package name with every character outside `A-Z a-z 0-9 . _ @ -` written `+`, so `@effected/engine` locks `@effected+engine.lock`. `.cache` is gitignored.
- The file is created exclusively (`wx`) and holds `{ pid, startedAt, cwd }`: the holding process, when it took the lock, and the package directory.
- **A waiting build is told who it waits for once,** through the engine's `Waiting` progress event, and `effected package build` prints that line on stderr. It looks again every 200 ms for at most five minutes, then fails `BuildLockTimeoutError` naming the holder and the file: exit 3, or a refusal from `package_build`.
- **A lock whose process no longer runs is taken over,** and so is one that still has no content five seconds after it was created. A pid reused by an unrelated process reads as alive, so that lock is waited out; the timeout message says to delete the file when no build is running.
- **Release is a scope finalizer,** so a crash, a failure and an interruption all give the lock back, and the file is removed only while it still holds this build's content.
- Two builds that find the same dead holder at once can still both proceed: each removes the file only if it still reads as the dead holder's, which narrows that window without closing it.
- An action build takes no lock.

## `process.env.__PACKAGE_VERSION__`

Every JS pass replaces this exact expression with the package's version through `define`, and a `define` key of the same name in the config wins. `packages/plugin/src/version.ts` and `packages/cli/src/version.ts` read it, falling back when the source runs unbuilt.

## An action's `dist`

An [`effected action build`](build-commands.md#effected-action-build) writes a different tree: one self-contained `dist/<entry>.js` per entry (`main`, `pre`, `post` and each worker), a `.js.map` beside it under `sourceMap`, and `dist/package.json` holding `{ "type": "module" }`. It has no `prod`, no `targets.json`, no `issues.json` and no journal lines; its verdict is the result the command returns.[^action-bundle]

[^bundler]: `packages/bundler/src/Bundler.ts`: the groups, the pass order, and writing `issues.json` on each terminal path.
[^issues]: `packages/bundler/src/report/issues-artifact.ts`: `BuildIssues`, `BuildIssuesSchema` and the atomic write.
[^targets-binding]: `packages/bundler/src/targets/binding.ts`: where `targets.json` lands.
[^targets-config]: `packages/bundler/src/targets/config.ts`: `TargetResolution`, `ResolvedGroup` and `ResolvedTarget`.
[^journal]: `packages/bundler/src/journal/BuildJournal.ts`: both journals, `layerAt` and `record`.
[^generate]: `packages/bundler/src/meta/generate.ts`: the meta bundle and its conditional members.
[^action-bundle]: `packages/bundler/src/action/ActionBundle.ts`: the entries and `dist/package.json`.
[^build-run]: `packages/engine/src/build/BuildRun.ts`: the freshness rule and the journal record.
[^build-lock]: `packages/engine/src/build/BuildLock.ts`: the lock file, the wait, the takeover and the release.
