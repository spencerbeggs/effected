---
type: Decision
title: A second published entrypoint is a measured cost, not a convenience
description: A package adds a subpath export only when a structural test proves an unbundled consumer would otherwise pay to load a part of the graph it never touches.
status: stable
tags:
  - bundle
  - dx
sources:
  - id: schema-org-package-json
    resource: ../../packages/schema-org/package.json
  - id: workspaces-package-json
    resource: ../../packages/workspaces/package.json
  - id: commands-package-json
    resource: ../../packages/commands/package.json
  - id: walker-package-json
    resource: ../../packages/walker/package.json
  - id: app-package-json
    resource: ../../packages/app/package.json
  - id: mcp-package-json
    resource: ../../packages/mcp/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: f64f2a8b421058e8
  verified:
    by: human:spencer
    at: 2026-10-25T20:04:29Z
    content: 4910a0c64c1c883a
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-10-25T20:04:29Z
---

# A second published entrypoint is a measured cost, not a convenience

## Context

Most packages ship a single `.` entrypoint. Among those that do not:
`@effected/workspaces`, `@effected/commands` and `@effected/walker` each add
`./node-sync`, `@effected/schema-org` adds `./validate`, `@effected/app`
adds `./testing`, and `@effected/mcp` adds
`./node`.[^schema-org-package-json][^workspaces-package-json][^commands-package-json][^walker-package-json][^app-package-json][^mcp-package-json] `"sideEffects": false` sounds like
it already solves the tree-shaking problem a subpath would solve, and
believing that is the trap this decision exists to name.

`sideEffects: false` and a subpath entrypoint answer two different
questions:

- For a **bundled** consumer, a re-export barrel tree-shakes correctly.
  Named exports stay individually reachable, so importing one class from
  `src/index.ts` retains only that class's graph. This is the case
  `sideEffects: false` describes, and it is why entrypoints are permitted
  to re-export at all.
- For an **unbundled Node consumer** — a CLI, a test run, a server,
  anything running the published files directly — there is no
  tree-shaker. Importing one named export from `index.ts` evaluates the
  whole module graph the file re-exports, whether or not that binding
  reads from it.

## Decision

A subpath entrypoint is the only mechanism that makes a heavy, optional
part of a package cost zero for the consumers that do not use it, and it
is justified by measurement rather than preference. `schema-org` split
`./validate` because the vocabulary table behind it is raw bytes an
graph-only consumer would otherwise load on every import — the raw
figure is the one that matters, not the gzip figure, because parse cost
is what an unbundled consumer pays. The `./node-sync` splits are the
same mechanism for a different cost: each holds the one `node:` import
(`node:fs`/`node:path`, `node:child_process`) a sync facade's Node binding
needs, which a main entry that takes its platform through `R` must never
load. Walker's `./node-sync` binds `descendSync` / `descendEntriesSync` to
`node:fs` and `node:path` (`nodeWalkerFileSystem`, `nodeWalkerPath`,
`nodeWalkerSyncOps`). `app`'s `./testing` is the same mechanism for test
code: `AppTest.layer` reaches `@effected/memfs`, an optional peer, which a
production importer of `App` must never load; see
[app's test layer lives behind ./testing](app-testing-entrypoint.md).
`mcp`'s `./node` is the same mechanism for a Node-only capability: it
carries `StdioCapture`, whose `node:async_hooks` and `node:stream` imports
the boundary-tier root must never load; see
[`@effected/mcp` ships `StdioCapture` behind `./node`](mcp-node-subpath.md).

The wiring is three parts:

1. One extra `exports` key, for example `"./validate": "./src/conformance-entry.ts"`.
2. One entry file beside `src/index.ts`, re-exports only, carrying a
   `@packageDocumentation` block stating why the split exists.
3. Nothing else — turbo, the bundler and the api-extractor model path are
   per-package, not per-entrypoint.

A type named by the second entrypoint's signatures must be exported
**from that entrypoint**, not merely from `.`. Type-only re-exports
(`export type { … }`) are erased at runtime and cost the split nothing,
but where API Extractor needs the class value and not just its type — a
class used as a parameter type of an exported function — the value
re-export is required and is the honest cost of the split. Record which
one it is and why, at the re-export site.

The corollary is a test obligation: review cannot enforce a reachability
boundary, so a package with a split ships a structural test asserting it,
with a positive control — assert that the light entrypoint's transitive
module graph excludes the heavy module, and that the heavy entrypoint's
graph includes it, so a test that has quietly stopped resolving anything
fails instead of passing vacuously. Walker, app and mcp each carry theirs in
`__test__/entrypoints.test.ts`: walker's asserts that nothing reachable from
`.` is `./node-sync` or imports a `node:` built-in, app's that nothing
reachable from `.` names `@effected/memfs`, the testing modules or a
self-reference to `@effected/app/testing`, type-only imports included, and
mcp's that nothing reachable from `.` or `./testing` reaches `node.ts` or
`StdioCapture.ts`; all three have the positive control.

See [the case-collision rule](../gotchas/subpath-case-collision.md) for
the naming trap a subpath walks into on a case-insensitive filesystem.

## Alternatives rejected

- **Ship everything from `.` and rely on `sideEffects: false`.** Rejected
  because it only helps a bundled consumer; an unbundled Node consumer
  still pays for the whole graph on any import.
- **Split every package defensively.** Rejected as unmeasured cost: a
  subpath is justified only when a measured, heavy, optional part of the
  graph exists — most packages have no such part.

## Consequences

A package considering a split must first measure the raw byte cost of
the candidate module and write the reachability test before adding the
`exports` key, not after.

[^schema-org-package-json]: `packages/schema-org/package.json` — `exports` carries
    `"./validate": "./src/conformance-entry.ts"` alongside `.`.
[^workspaces-package-json]: `packages/workspaces/package.json` — `exports` carries
    `"./node-sync": "./src/node-sync.ts"` alongside `.`.
[^commands-package-json]: `packages/commands/package.json` — `exports` carries
    `"./node-sync": "./src/node-sync.ts"` alongside `.`; its reachability
    test is `__test__/entrypoints.test.ts`.
[^walker-package-json]: `packages/walker/package.json` — `exports` carries
    `"./node-sync": "./src/node-sync.ts"` alongside `.`; its reachability
    test is `__test__/entrypoints.test.ts`.
[^app-package-json]: `packages/app/package.json` — `exports` carries
    `"./testing": "./src/testing.ts"` alongside `.`, and `@effected/memfs`
    is marked optional in `peerDependenciesMeta`.
[^mcp-package-json]: `packages/mcp/package.json` — `exports` carries
    `"./node": "./src/node.ts"` alongside `.`; its reachability test is
    `__test__/entrypoints.test.ts`.
