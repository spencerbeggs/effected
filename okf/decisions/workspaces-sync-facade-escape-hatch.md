---
type: Decision
title: "WorkspacesSync is a `*Sync` escape hatch, not a `*Result` pure form"
description: "The synchronous WorkspacesSync facade exists for a caller that cannot await, and it is named `*Sync` rather than `*Result` because it is a total port over consumer-supplied IO, not a pure computation with a sync twin."
status: stable
tags:
  - architecture
  - dx
sources:
  - id: workspaces-sync-ts
    resource: ../../packages/workspaces/src/WorkspacesSync.ts
  - id: node-sync-ts
    resource: ../../packages/workspaces/src/node-sync.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 0a64a974e9c86d15
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 61380491cd3be372
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# WorkspacesSync is a `*Sync` escape hatch, not a `*Result` pure form

## Context

`src/WorkspacesSync.ts` ships two synchronous functions,
`findWorkspaceRootSync` and `getWorkspacePackagesSync`, positional-path-first
with an options bag second, with the cwd required rather than read from an
ambient default.[^workspaces-sync-ts] They exist because Vitest's
config-time project discovery cannot await: a test runner picking up
project configuration runs before any Effect runtime exists to drive an
asynchronous discovery call, so the gate consumer needs a synchronous
answer or it cannot participate at all.

Both functions drive the same worklist-based traversal state machine
(`internal/traverse.ts`) that the Effect enumerator uses, so a globstar
means the same thing in both worlds — the sync surface keeps no third
pattern semantic. The one deliberate divergence is at a bound: the Effect
path fails typed, and the sync path truncates, because `getWorkspacePackagesSync`
has no error channel to fail a bad manifest through.

## Decision

Name the family `*Sync`, not `*Result`, and shape it as a total port over
consumer-supplied IO rather than a pure computation with two forms.

The `*Result`/`Effect` pairing elsewhere in the kit names two forms of the
*same pure computation* — a synchronous `Result`-returning function and an
`Effect`-wrapped async twin over the identical logic, with the sync form
holding no privileged claim to a platform. `WorkspacesSync` is a different
shape entirely: it is total (`getWorkspacePackagesSync` has no error
channel at all, reporting failure only through an optional `onSkip`
callback), it takes its platform from the caller rather than being
platform-free, and it exists specifically *because* the async Effect form
cannot run in the calling context — not as an interchangeable alternative
to it.

The kit's naming convention keeps `*Result` reserved for a synchronous pure
primitive that has an `Effect` sibling over the same computation, and uses
`*Sync` for a facade whose entire reason to exist is bridging into a
synchronous host: the two names encode different contracts, and using
`*Result` here would claim a pure-computation symmetry `WorkspacesSync`
does not have.

The design rule that binds every sync escape hatch in the kit, not only
this one: the kit never imports `node:*` on its main path and never assumes
POSIX, so a sync surface takes the platform from its caller. The options
bag carries minimal structural filesystem and path interfaces that Node's
built-ins satisfy verbatim; Windows correctness is therefore the consumer's
responsibility, passing a win32-appropriate path implementation, not
anything this module does on its own.

The `./node-sync` subpath (`src/node-sync.ts`) supplies ready-made
`node:fs` / `node:path` bindings so the common Node case is one import,
while staying unreachable from the main entry point — hand-wiring the
built-in one-liners at every adoption site would be a tax the platform-free
rule imposes on the common case, and a tax paid per consumer is a tax paid
wrong.[^node-sync-ts]

## Alternatives rejected

- **Name the family `*Result`, matching the kit's sync-primitive
  convention.** Rejected because `*Result` names a pure computation's
  synchronous form with an `Effect` twin over identical logic; this facade
  is total port-taking IO with no error channel, existing because the
  async form cannot run here at all, not as an equally-valid alternative
  form of the same computation.
- **Give the sync surface an ambient `process.cwd()` default, matching the
  Effect-side layers.** Rejected because the sync module's reason to exist
  is a caller — Vitest's config-time discovery — that cannot rely on any
  ambient timing; requiring the cwd keeps the contract explicit about what
  it does not read.

## Consequences

A reader who sees `*Sync` in this kit should expect a total,
consumer-supplied-IO facade bridging into a synchronous host, not a pure
computation's synchronous twin — that expectation is reserved for
`*Result`. See [the sync-primitive naming decision](sync-form-named-result.md)
for the `*Result` side of this distinction.

[^workspaces-sync-ts]: `packages/workspaces/src/WorkspacesSync.ts` —
    `findWorkspaceRootSync`, `getWorkspacePackagesSync`, `SyncFileSystem`,
    `SyncPath`.
[^node-sync-ts]: `packages/workspaces/src/node-sync.ts` — the Node-bound
    ops preset published only under `./node-sync`.
