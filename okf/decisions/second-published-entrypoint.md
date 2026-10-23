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
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 71d7706757a9d4d1
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: a9a8f4282735530b
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# A second published entrypoint is a measured cost, not a convenience

## Context

Most packages ship a single `.` entrypoint. Two do not:
`@effected/workspaces` adds `./node-sync`, and `@effected/schema-org` adds
`./validate`.[^schema-org-package-json][^workspaces-package-json] `"sideEffects": false` sounds like
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
is what an unbundled consumer pays.

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
fails instead of passing vacuously.

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
