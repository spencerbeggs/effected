---
type: Decision
title: app's test layer lives behind ./testing, with memfs an optional peer
description: AppTest.layer ships from @effected/app/testing rather than as App.layerTest on the root, and @effected/memfs is an optional peer only that entrypoint reaches, so no production importer of App loads a test filesystem; a reachability test enforces it.
status: draft
tags:
  - bundle
  - deps
  - testing
sources:
  - id: app-package-json
    resource: ../../packages/app/package.json
  - id: app-testing-entry
    resource: ../../packages/app/src/testing.ts
  - id: app-entrypoints-test
    resource: ../../packages/app/__test__/entrypoints.test.ts
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-26T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: 738f3bcf43b3b742
---

# app's test layer lives behind ./testing, with memfs an optional peer

## Context

The hermetic control plane used to be `App.layerTest` on the root entry.
Its output names `MemoryFileSystemVolume`, so `@effected/memfs` was a
required runtime peer, and every production importer of `App` evaluated a
test filesystem it never used: an unbundled Node consumer has no
tree-shaker (see [a second published entrypoint is a measured
cost](second-published-entrypoint.md)). The owner ruled the edge moves
behind a testing entrypoint (kit-ports 25r.4), while confirming that unused
peers are otherwise acceptable and that developer experience outranks
shrinking a closure.[^owner-ruling]

## Decision

- **The test layer is `AppTest.layer(options)`, exported only from
  `@effected/app/testing`** (`src/testing.ts` re-exporting `src/AppTest.ts`:
  `AppTest`, `AppTestOptions`, `AppTestServices`).[^app-testing-entry] The
  root exports `App`, `AppCache`, `AppConfig` and `AppStore` and nothing
  test-shaped; `App.layerTest` is gone.
- **`@effected/memfs` stays a peer but is marked optional** in
  `peerDependenciesMeta`.[^app-package-json] It is still a shared-instance
  contract (a test resolves the `MemoryFileSystem.Volume` key from its own
  import), so it is not a regular dependency; it is optional because only
  `./testing` needs it. A consumer that uses `AppTest` adds memfs as a
  devDependency, since package managers do not install optional peers.
- **The error union narrowed** from `AppError` to `StoreError |
  StoreMigrationError | CacheError`, the errors the layer can actually raise
  (`Xdg.layerFrom` and `AppDirs.layer` cannot fail).
- **A structural test enforces the boundary**: it walks the module graph
  from `src/index.ts` and fails on any `@effected/memfs` specifier
  (type-only imports included, since those still break type resolution for
  a consumer who skipped the optional peer), any `AppTest` or `testing`
  module, or a self-reference to `@effected/app/testing`; a positive control
  walks from `src/testing.ts` and must reach both; a third case proves the
  walker resolves the main entry's modules; a fourth asserts the two entries
  export disjoint surfaces.[^app-entrypoints-test]

## Alternatives rejected

**Keep `App.layerTest` on the root with memfs a required peer.** Rejected
because it charges every production importer for test code.

**Make memfs a devDependency only.** Rejected because `AppTest.layer` is
shipped API whose types name memfs; a consumer's test must resolve the same
`Volume` key, which is what a peer guarantees.

**Drop the hermetic layer and let consumers compose it.** Rejected on
developer experience: the one-line, `R = never` first test is the point of
the layer.

## Consequences

A consumer migrating imports `AppTest` from `@effected/app/testing`, renames
`App.layerTest` to `AppTest.layer`, adds `@effected/memfs` to its
devDependencies, and may narrow a `catchTags` list that named the wider
`AppError`. The move is breaking for the 0.x line. Other packages with a
test-only edge follow the same shape: a `./testing` subpath, an optional
peer, and a reachability test with a positive control.

[^owner-ruling]: Conversation with the repository owner, 2026-10-26: app→memfs moves behind `@effected/app/testing` (25r.4); unused peers are otherwise acceptable, and developer experience comes before closure-shrinking.
[^app-testing-entry]: `packages/app/src/testing.ts` — the `./testing` entry and its `@packageDocumentation` stating why the split exists.
[^app-package-json]: `packages/app/package.json` — `"./testing": "./src/testing.ts"` in `exports`, and `@effected/memfs` with `"optional": true` in `peerDependenciesMeta`.
[^app-entrypoints-test]: `packages/app/__test__/entrypoints.test.ts` — the reachability walk, its positive control and the disjoint-surface check.
