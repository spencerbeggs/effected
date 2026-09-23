---
type: Decision
title: "D9: CliTest uses core ChildProcess, with no peer on @effected/commands"
description: The new @effected/cli/testing subpath spawns fixture binaries directly over effect core's ChildProcess contract rather than adding an optional peer on @effected/commands.
status: stable
tags: [architecture, testing, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: bc110660511c8e01ff43c08a31f4f2ef9cff053ab2ac97fae5b1a953ad99c609
verified:
  - by: human:spencer
    at: 2026-09-23T19:50:29Z
---

# D9: `CliTest` uses core `ChildProcess`, with no peer on `@effected/commands`

## Context

`CliTest.run` needs to spawn a fixture binary and capture its exit code,
stdout and stderr for a `CliRuntime.main` or `reportFailures` test —
exactly the shape `@effected/commands`' `Run` already provides, over the
same underlying `ChildProcessSpawner` contract core exposes directly.
Reaching for `@effected/commands` would mean either a required dependency
— unacceptable for a `boundary`-tier testing subpath whose package,
`@effected/cli`, currently depends on nothing but `effect` and the
optional `@effected/config-file` peer — or an *optional* peer, mirroring
the `config-file` pattern `cli.md` already documents for
`ConfigIssueRenderer`. But `@effected/commands` brings tool-discovery and
argv-prefix machinery (`npm exec`, `pnpm dlx`, and the rest of its table)
that a test harness spawning one already-known fixture binary has no use
for; the optional-peer pattern earns its keep in `ConfigIssueRenderer`
because rendering genuinely needs `@effected/config-file`'s error shape,
and `CliTest` has no equivalent need for `@effected/commands`' tool
resolution.

## Decision

`CliTest.run` spawns `execPath` with `[bin, ...args]` directly over core's
`ChildProcess` contract (`ChildProcessSpawner`), the same contract
`@effected/commands` itself is built on. `@effected/cli/testing` takes no
dependency, optional or required, on `@effected/commands`.

## Alternatives rejected

**An optional peer on `@effected/commands`.** Rejected — the
tool-discovery and prefix-resolution machinery `Run` provides has no
counterpart need in `CliTest.run`'s contract, which always receives an
already-known `execPath` and `bin` from the calling test file rather than
resolving either one itself. Adding the peer would cost every `cli`
consumer an unused optional-peer entry in their manifest for a capability
`CliTest` never calls.

## Consequences

`CliTest.sandbox` and `CliTest.run` fix three traps the hand-rolled
per-consumer versions carried: vitest-agent's `spawnSync` throws on a
non-zero exit rather than returning it as data; Silk's harness leaks the
host `HOME` into the spawned process; and a `PATH`-dependent `node` lookup
can resolve to the wrong binary when `PATH` is inherited rather than
injected. `CliTest.sandbox` sets a fresh `HOME` and
`XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR=1`, and takes `PATH` from
an injected value, never `extendEnv`'s inherited default. `CliTest.run`'s
`Effect<{ exitCode; stdout; stderr }, PlatformError, ChildProcessSpawner | Scope>`
signature treats a non-zero exit as ordinary data, matching the design's
own principle that a findings exit and a crash must stay distinguishable
— the same principle [D7](usage-exit-code-defaults-to-64.md) applies to
`usageExitCode`.
