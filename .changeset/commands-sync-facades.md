---
"@effected/commands": minor
---

## Features

### Synchronous tool discovery

`makeToolDiscoverySync` builds a `ToolDiscoverySync` for callers that have no Effect runtime. It gives the same answers and the same caching as `ToolDiscovery`. It is configured with `ToolDiscoverySyncOptions` and a `SyncSpawn` function that returns a `SyncSpawnResult`, and it reports a `ToolSyncResolutionFailure` when a tool cannot be resolved.

The new `@effected/commands/node-sync` subpath exports `nodeSpawnSync`, the Node `SyncSpawn` implementation.

### Tool preference and argv

* `Tool.prefer` and `ToolPreference` choose between a project-local and a global tool. The default is local.
* `ResolvedTool.argv()` returns the argument vector that runs the resolved tool, launcher prefix included (`["pnpm", "exec", "biome", …]` for a local copy), for handing a command line to another runner.
* `LocalExec.contextFor()` returns the execution context for a known package manager as a plain value, optionally scoped to a directory.

## Bug Fixes

* A project-local probe now needs exit code 0 to count as found. Previously any tool read as locally present wherever the launcher (pnpm, npx, yarn, bun) existed, because `pnpm exec missing --version` starts and exits 1. Tools that were wrongly reported as local now fall through to the global probe or report as missing. Global probes are unchanged. Because a launcher returns the same exit code for a missing tool and for a tool that rejects its arguments, the probe's arguments must also succeed locally: a presence-only probe still runs `--version`, and `VersionNone` gains an optional `flag` for a tool that rejects it (`VersionNone.make({ flag: "--help" })`).

## Refactoring

* `Redaction.apply`, `applyArgs` and `scrubArgs`, `Retry.isTransient` and `transient`, and `Run.stream` are now static methods, and `Run.collect` and its siblings carry real signatures in the published declarations. Call shapes are unchanged.
