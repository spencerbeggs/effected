---
type: Decision
title: "@effected/mcp ships StdioCapture behind a Node-only ./node subpath, licensed for two node: imports"
description: "StdioCapture needs node:async_hooks for its capture context and node:stream for nullWritable, so it ships from @effected/mcp/node, which the root and ./testing never reach (a reachability test pins it), following jsonl's ./node precedent; the boundary licence is exactly those two imports in StdioCapture.ts, and its host is structural, so it reads no process."
status: draft
tags: [architecture, bundle, compat]
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    title: "kit-ports user ruling 2026-10-26: a new @effected/mcp/node subpath"
    author: human:spencer
    last_modified: 2026-10-26T00:00:00Z
  - id: stdio-capture
    resource: ../../packages/mcp/src/StdioCapture.ts
    title: "StdioCapture: a process-global registry, AsyncLocalStorage routing, the two escape paths, the masked fork"
  - id: mcp-entrypoints-test
    resource: ../../packages/mcp/__test__/entrypoints.test.ts
    title: "Nothing reachable from . or ./testing reaches node.ts or StdioCapture.ts, with a positive control from ./node"
  - id: mcp-boundary-test
    resource: ../../packages/mcp/__test__/boundary.test.ts
    title: "The ./node licence waives exactly node:async_hooks and node:stream in StdioCapture.ts"
  - id: fiber-async-context
    resource: ../../.repos/effect/packages/effect/src/internal/effect.ts
    title: "A fiber captures an AsyncResource when it yields and resumes inside it (lines 505-514, 616-636)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: 86d6c1e69bab5334
---

# `@effected/mcp` ships `StdioCapture` behind a Node-only `./node` subpath

## Context

Over stdio, an MCP server's stdout is the JSON-RPC wire. A tool that runs
a chatty library in-process (a test runner, a bundler, a linter) has to
keep that library's output off the wire while other handlers, and the
transport itself, keep writing to it. Patching `process.stdout.write` for
the duration of one call is wrong under concurrency: every other request's
writes would be diverted with it. The routing has to follow the *async
context* of the call, which on Node is `AsyncLocalStorage` from
`node:async_hooks`.

`@effected/mcp` is [boundary tier](../glossary/library-tier.md): its root
reads no `process` and imports no `node:` module, and its boundary test
holds that. `@effected/jsonl` met the same tension for its Node watch
backend and resolved it with an opt-in `./node` subpath
([precedent](jsonl-watch-arms-before-success.md)), under the
[second-entrypoint rule](second-published-entrypoint.md) that a subpath is
justified by a structural test, not by preference.

## Decision

`StdioCapture` (with `StdioSink`, `StdioCaptureHost` and
`StdioCaptureOptions`) ships from `@effected/mcp/node` alone.[^owner-ruling]
A reachability test pins that nothing reachable from `.` or `./testing`
reaches `node.ts` or `StdioCapture.ts`, with a positive control that `./node`
does.[^mcp-entrypoints-test]

The boundary licence is file-scoped and exact: `StdioCapture.ts` may import
`node:async_hooks` (the capture context) and `node:stream` (the `Writable`
behind `StdioCapture.nullWritable`), and nothing else from Node. The
boundary test asserts the waived set equals those two imports, so a third
fails it.[^mcp-boundary-test] Every other rule still holds in that file:
the host is structural (`StdioCaptureHost`, two `StdioSink`s with a
replaceable `write`), so `main.ts` passes `process` in and the module reads
no `process` itself.

The semantics the licence buys:[^stdio-capture]

- **One registry per process.** The `AsyncLocalStorage` and each patched
  stream's original `write` live on `globalThis` under a `Symbol.for` key,
  and the originals are keyed by the stream object, so two installed copies
  of the package, or two host objects over one stream, share one patch and
  one routing context instead of stacking.
- **Fibers keep their own context.** A core fiber captures an
  `AsyncResource` when it yields and resumes inside it,[^fiber-async-context]
  so a server fiber woken by code inside a capture (its response offered to
  a queue) still writes to the wire.
- **Two escape paths, documented rather than closed.** A callback registered
  outside the capture keeps the context it was registered in (a native
  addon, worker output relayed by the main thread, a pipe listener attached
  earlier) and reaches the real stream. A fiber forked inside the capture
  (`Effect.forkDetach`, a memoized layer first built there, a library's
  background fiber) keeps writing to the sink after the capture ends.
- **The fork cannot be orphaned.** `capture` forks the effect inside the
  storage context and installs its interrupt finalizer under
  `Effect.uninterruptibleMask`, so an interrupt landing between the fork and
  the `ensuring` cannot leave the inner fiber running; only the join is
  interruptible.

## Alternatives rejected

- **Export it from the root.** Rejected: every consumer, the non-Node ones
  included, would load `node:async_hooks` on import, and the root's boundary
  tier would end.
- **A directory- or package-wide `node:` waiver.** Rejected for the reason
  [cli's `./ui` licence](ui-binds-process-streams.md) gives: a wide waiver
  lets any new module reach for Node silently.
- **Patch the streams for the duration of a call, without async context.**
  Rejected: under concurrent requests it diverts every other handler's
  writes, and the wire's own, along with the library's.
- **`StdioCapture.discard` as the only null sink.** Kept, but not alone: it
  is write-only, so a library that pipes into its logger stream or calls
  `setMaxListeners` on it needs a real `Writable`. `nullWritable()` is that
  stream, a factory because a piped source ends its destination.

## Consequences

`./node` is the package's one platform-bound surface, read per entrypoint
as jsonl's is: the root stays boundary, and only an importer of `./node`
takes Node. A consumer on a runtime without `node:async_hooks` uses the rest
of the package unchanged. Adding a Node-only export to `./node` means
widening the boundary test's exact waiver list, a reviewed edit to one test.

[^owner-ruling]: conversation with the repository owner, 2026-10-26
[^stdio-capture]: `../../packages/mcp/src/StdioCapture.ts`
[^mcp-entrypoints-test]: `../../packages/mcp/__test__/entrypoints.test.ts`
[^mcp-boundary-test]: `../../packages/mcp/__test__/boundary.test.ts`
[^fiber-async-context]: `../../.repos/effect/packages/effect/src/internal/effect.ts`, lines 505-514 and 616-636
