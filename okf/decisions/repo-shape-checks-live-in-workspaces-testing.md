---
type: Decision
title: "D5: the layering, packed-install and boundary checks live in @effected/workspaces/testing"
description: WorkspaceLayering, PackedInstall and SourceBoundary join a new testing subpath on the existing integrated-tier workspaces package rather than a dedicated package or an engine/testing subpath.
status: draft
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 8da4d7914038a1d96aad16f1fc000d790e8c2cc87d9a22898ee06347feed7d2a
---

# D5: the layering, packed-install and boundary checks live in `@effected/workspaces/testing`

## Context

Three consumer repos each maintain their own repo-shape checks: a ranked
dependency-layering test (`WorkspaceLayering`), a multi-package-manager
packed-install e2e (`PackedInstall`), and a source-boundary scanner that
flags a `process` read leaking into a module meant to stay pure
(`SourceBoundary`). All three need a discovered package graph and a real
package-manager surface — exactly what `@effected/workspaces` already
owns through `WorkspaceDiscovery`, `DependencyGraph`, and `@effected/npm`'s
`PackagePublish`/`PackageTarball`. None of the three need `effect` alone;
each is meaningless without a real monorepo to check, which is a different
dependency shape than `@effected/engine`'s pure, platform-free primitives.

## Decision

`WorkspaceLayering`, `PackedInstall` and `SourceBoundary` ship as a new
`@effected/workspaces/testing` subpath on the existing `@effected/workspaces`
package (planned for phase 3), reusing its existing dependencies —
`@effected/npm`, `@effected/commands`, `@effected/glob` — rather than
adding new ones. `okf/modules/workspaces.md` gains a "Planned: `./testing`
subpath (phase 3)" paragraph naming the three exports.

## Alternatives rejected

**A dedicated testing package.** Rejected — it would need to re-declare
`workspaces`' own dependency surface (`WorkspaceDiscovery`,
`DependencyGraph`, the pnpm-catalog machinery) or take a runtime
dependency on `@effected/workspaces` itself, either duplicating
integrated-tier weight or adding a needless indirection for three exports
that already belong beside the package whose model they check.

**`engine/testing`.** Rejected — `@effected/engine` is deliberately pure
tier with `effect` as its only peer (see [D1](engine-holds-cross-front-end-primitives.md)).
`PackedInstall` alone requires `ChildProcessSpawner`, `FileSystem`, `Path`
and `WorkspaceDiscovery`; folding it under `engine/testing` would drag
`engine` from pure to boundary or integrated for a subpath that has
nothing to do with the cross-front-end primitives `engine` exists to hold.

## Consequences

`@effected/workspaces` keeps its existing tier (integrated) unchanged;
the new subpath inherits it, per the design's own tier-inheritance rule
for testing subpaths. The subpath earns its own reachability test with a
positive control, per
[`second-published-entrypoint.md`](second-published-entrypoint.md), since
it is exactly the kind of second entrypoint that decision requires a
measured justification for — here, a consumer that only needs
`WorkspaceLayering`'s pure `check` function must not pay to load
`PackedInstall`'s package-manager-spawning machinery. Phase 3 is where
this ships; phase 1 records only the Decision and the `workspaces.md`
pointer.
