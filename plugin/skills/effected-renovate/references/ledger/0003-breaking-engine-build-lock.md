---
id: "0003"
title: "@effected/engine: BuildRun.run waits on a per-package lock, can fail BuildLockTimeoutError, and reports Waiting"
kind: breaking
shows: typed
applies:
  "@effected/engine": ">=0.17.0"
detect: ["BuildRun\\.run\\(", "_tag[[:space:]]*(===|:)[[:space:]]*\"PassDone\""]
changesets: ["engine-build-lock", "cli-build-lock", "mcp-build-lock"]
closes: ["spencerbeggs/effected#1291"]
---

This applies only to a repository that calls `@effected/engine`'s `BuildRun.run` directly. One that builds through `effected package build` or the `package_build` MCP tool needs no code change.

`BuildRun.run` now holds a lock at `<root>/.cache/effected/locks/<name>.lock` from before the bundler cleans `dist` until the journals are written, so a second build of the same package waits instead of racing the first. A lock whose process is dead is reclaimed, and the lock is released on failure or interruption.

- **The error channel gains `BuildLockTimeoutError`**, when another build holds the lock for the whole wait. A caller that handles the run's failures by tag adds that case.
- **`BuildProgress` gains `Waiting`**, sent to `onProgress` at most once, before `Started`, with the lock path and the holder as an `Option`. A `switch` over `_tag` with an exhaustiveness check fails to typecheck until it handles `Waiting`.
- **`BuildRunDeps.lock`** takes `BuildLockOptions` to set the wait; omitted, it is five minutes. A test that runs two builds of one package at once may want a short wait.

The tool's front ends carry the same change, with nothing to edit: `effected package build` prints one stderr line naming the holder and the lock path while it waits, and exits `3` if the lock is held for the whole wait; `package_build` refuses with a message to wait and call again. A CI script that treats exit `3` specially should know it now also means a lock timeout. The lock lives under `.cache`, which a repository on the tool already ignores.

Read the installed `.d.ts` for `BuildProgress`, `BuildLockOptions`, `BuildLockHolder` and `BuildLockTimeoutError`. Verify with the typecheck.
