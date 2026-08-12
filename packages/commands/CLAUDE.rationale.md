# Rationale — @effected/commands

Why the parent's rules exist: the deleted predecessors, the probes, and the
incidents. Evidence only — the rules themselves live in the parent.

**Parent:** [@effected/commands context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/commands.md`

## The two deleted predecessors

A previous `@effected/commands` violated "every subprocess concept here is
core's, and no implementation of one is" twice:

1. It invented `Command` / `CommandRunner` / `CommandSpawnError` (plan
   `2026-07-14-commands-runner-core.md`).
2. It deleted all that and then **ported `@effect/platform-node-shared`'s
   spawner into the package** (plan `2026-07-14-commands-spawner-pivot.md`).

The second is the subtle one, and the reason the rule is phrased the way it is.

## The backpressure deadlock

Collecting stdout, stderr and the exit code sequentially deadlocks the moment
either OS pipe buffer fills: the child blocks writing to a full pipe while the
reader that would drain it is still waiting on the other stream. Not theory —
flipping `collectRaw` to `{ concurrency: 1 }` makes
`__test__/e2e/Run.e2e.test.ts`'s backpressure test hang until its 30s timeout. A
mock spawner over in-memory streams cannot reproduce it, and pressure on one
stream does not discriminate.

## `Run.jsonLine`'s widened contract

`jsonLine` scans stdout lines from the end (split on `\r?\n`, whitespace-only
lines dropped) and takes the first that both JSON-parses and decodes under the
schema. #292 widened the old "last non-empty line must decode" contract after an
exit-hook log line displaced a consumer's payload.

Nothing decoding anywhere is a typed `CommandOutputError` carrying the exit code
and both redacted streams — kind `"schema"` with the last JSON-parseable line's
decode issue as `cause` when at least one line parsed, `"notJson"` only when no
line anywhere was JSON.

`@effected/workspaces`' `ConfigDependencyHooks.layerSubprocess` is the in-kit
consumer; it deleted a hand-rolled copy of this framing.

## Presence detection

There is no `command -v` probe because v3 interpolated the tool name into
`sh -c`, which was both an injection hazard and broken on Windows. The e2e suite
pins the platform backend's ENOENT → `NotFound` mapping because the whole
classification rests on it.

## The evidence cache

`ToolDiscovery` caches probe evidence keyed by `(name, version probe)` as a
`Schema.Class` (structural `Equal`/`Hash`, verified at beta.101 including nested
union members). v3 keyed *resolved answers* by name alone and silently handed
the first caller's policy decision to the second.

Two TTL traps, both probed 2026-07-25 and both handled by one `timeToLive`:

1. Core `Cache` memoizes a **failed** lookup for the entry's TTL — one transient
   failure would stick for the process lifetime.
2. "Not found" is a **successful** lookup carrying negative evidence. Memoized, a
   tool installed mid-process (an action that provisions a runtime and then uses
   it) stays absent forever.

Hence: only a positive result gets `Duration.infinity`. A tool that exists does
not stop existing; a tool that does not exist very often starts to.

Core `Cache` does **not** share `Effect.cached`'s interrupt-poisoning property
(probed with a control that reproduced the poisoning first) — an interrupted
lookup is discarded and re-run.

## `Run.detach`

The Node backend tracks an `isReferenced` flag and its `acquireRelease` release
**skips the kill** for an unref'd child, so `detach` is spawn → `unref` → pid.

Not in this package: signalling a bare pid later (no handle across an Actions
main→post boundary; needs `node:process.kill`) and readiness polling — both
belong to `@effected/github-actions`. Routing a detached child's output to a log
file is an **upstream gap**: core's `CommandOptions` accepts only
`"pipe" | "inherit" | "ignore" | "overlapped" | Sink`, and the Node backend maps
a `Sink` to `"pipe"`, which defeats detachment.

## The `extendEnv` mechanics

Core's `setEnv` merges into `options.env` but never sets `extendEnv`, and the
Node spawner resolves the child environment as
`extendEnv ? { ...process.env, ...env } : env`. `Run.extendEnv` merges like
`setEnv` (new values win) AND forces `extendEnv: true` — deliberately, even over
a construction-time `false`, because inheriting the parent env is its whole
purpose. It composes public `ChildProcess.make`/`pipeTo`, so it re-declares
nothing. The unit suite carries a CONTROL pinning the core behaviour itself: if
that control fails, a core beta changed `setEnv` and the combinator's raison
d'être needs re-evaluating.

## Why `LocalExec.makeTest` may default

`ToolDiscovery.makeTest` follows the kit convention — every unstubbed member
dies naming itself, because a fabricated `ResolvedTool` would leak into consumer
logic as fact. `LocalExec`'s one member has a correct, real answer for the
unstubbed case: `Option.none()` *is* the global-only wiring. Dying there would
force every consumer test to stub a member it does not care about, to assert
something the double already knows.

## Biome, beyond the two rules

`useImportType` fires on a symbol used **only** in a type position
(`LocalExecError` appears solely in the `ToolResolutionFailure` union), and the
Biome LSP only sees files you have touched — run `biome_check` over the whole
package before handing work off, or a formatting-only diff bounces the
pre-commit hook.
