---
type: Decision
title: The kit's layering check forbids runtime edges only
description: The front-end kit's forbidden package edges are runtime edges, so this repository's layers.json checks dependencies, peerDependencies and optionalDependencies, and test-only devDependencies may point up.
status: stable
tags:
  - architecture
sources:
  - id: layers-json
    resource: ../../lib/configs/layers.json
  - id: layering-int-test
    resource: ../../packages/workspaces/__test__/integration/layering.int.test.ts
  - id: engine-package-json
    resource: ../../packages/kit/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T15:53:05Z
verified:
  - by: human:spencer
    at: 2026-09-24T06:10:09Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
  - by: human:spencer
    at: 2026-11-02T17:04:46Z
integrity:
  generated:
    body: 9c498d5cc9a93bee
  verified:
    by: human:spencer
    at: 2026-11-02T17:04:46Z
    content: 2fb97666b74b318a
---

# The kit's layering check forbids runtime edges only

## Context

The front-end kit design forbids five package edges: `cli-kit` to `mcp-kit`, `mcp-kit` to
`cli-kit`, `mcp-kit` to `workspaces`, `workspaces` to `mcp-kit`, and `kit` to anything
else in the kit. Phase 3 then shipped `SourceBoundary` in
`@effected/workspaces/testing`, and `kit`, `mcp-kit` and `cli-kit` each adopted it
for their own boundary tests. Each takes `@effected/workspaces` as a
`workspace:*` **devDependency**.[^engine-package-json] Read over all four
dependency fields, those are `upward` edges, and `kit`'s is exactly the
edge the design forbids.

A devDependency is never installed for a package's consumers. No install
graph gains an edge, and `mcp-kit`'s peers and dependencies still never name
`workspaces`. What the forbidden edges protect is what a consumer installs
and loads.

## Decision

The forbidden edges are **runtime** edges. This repository's
`lib/configs/layers.json` sets `fields` to `dependencies`,
`peerDependencies` and `optionalDependencies`.[^layers-json] It places `cli-kit`,
`mcp-kit` and `workspaces` in one layer, so a runtime edge between any two of
them is a `sameLayer` offence, and it places `kit` in the bottom layer.
Test-only devDependencies may point up.

## Alternatives rejected

**Check all four fields.** It would forbid `kit` from testing itself with
the kit's own scanner, and force a copy of `SourceBoundary` into `kit`'s
test tree, which is the hand-rolled scanner phase 3 replaced.

**A dedicated fixtures or test-support package** at the bottom layer, so the
devDependency points down. Unneeded: `SourceBoundary` ships its own positive
controls (`fixtures` and `verifyFixtures`), so nothing a boundary test needs
lives anywhere but `@effected/workspaces/testing`, and a new package would
add a release unit for no runtime benefit.

## Consequences

- Acyclicity across **all four** fields is pinned separately. The layering
  integration test asserts `DependencyGraph.hasCycle` is false over the whole
  discovered graph, so a devDependency still cannot close a
  cycle.[^layering-int-test]
- The same test proves the devDependency edges exist and would be caught if
  the policy checked them: it asserts
  `@effected/kit -> @effected/workspaces (devDependencies)` is an edge,
  and that an all-field policy reports it as `upward`.
- Each design-forbidden edge has a positive control in that test: planting
  it as a peer edge yields exactly the expected offence.

[^layers-json]: `lib/configs/layers.json` — `fields` and the layer placing
    `cli-kit`, `mcp-kit` and `workspaces` together.
[^layering-int-test]: `packages/workspaces/__test__/integration/layering.int.test.ts`
    — the policy check, the forbidden-edge controls, the devDependency test
    and the all-field acyclicity assertion.
[^engine-package-json]: `packages/kit/package.json` — the `workspace:*`
    devDependency on `@effected/workspaces`.
