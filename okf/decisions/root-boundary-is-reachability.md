---
type: Decision
title: The cli root boundary is a module-graph walk, not a per-file scan
description: "boundary.test.ts proves the root never reaches ./ui by walking the import graph from src/index.ts and src/testing.ts, because SourceBoundary.scan checks files one at a time and missed a root file importing a ui module (probe P4)."
status: draft
tags: [testing, bundle]
sources:
  - id: probe-p4
    resource: "P4 design probe P4, run 2026-09-30 over five synthetic source trees with SourceBoundary.scan, a prefix-forbid variant and the reachableFrom walker"
    title: "Probe P4: the root module-graph scan"
  - id: source-boundary
    resource: ../../packages/workspaces/src/SourceBoundary.ts
    title: "SourceBoundary.scan and SourceBoundary.importSpecifiers"
  - id: workspaces-entrypoints
    resource: ../../packages/workspaces/__test__/entrypoints.test.ts
    title: The reachableFrom walker the cli test copies
  - id: cli-boundary-test
    resource: ../../packages/cli/__test__/boundary.test.ts
    title: The cli boundary test
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T03:23:20Z
  body_sha256: a5ae698a88b1a16f29096daae1ba2f0e8ea0fcea3a8c068b0691988d65d8ce83
---

# The cli root boundary is a module-graph walk, not a per-file scan

## Context

[The ./ui subpath decision](ui-is-a-subpath-with-optional-peers.md) needs a
test that the root never reaches `./ui`. `SourceBoundary.scan` walks every
file under a directory and checks each in isolation; it has no entry point
and no notion of reachability.[^source-boundary] Probe P4 ran it over five
synthetic trees.[^probe-p4]

- A scan with the ui files waived **missed** a root file that statically
  imports `./ui/Screen.js`, a nested `commands/run.ts` that imports
  `../ui/Screen.js`, and a root file that lazily imports `./ui.js`. None of
  those files names `ink` itself.
- Adding `"./ui*"` and `"../ui*"` to the forbidden imports caught the two
  shapes tried, but it is text matching: it misses a deeper `../../ui/…` and
  wrongly flags an unrelated `./uiHelpers.js`.
- The `reachableFrom` walker caught **every** variant, nested included.

## Decision

`packages/cli/__test__/boundary.test.ts` has two parts.[^cli-boundary-test]

- **Part 2, the boundary, is reachability.** A walk over
  `SourceBoundary.importSpecifiers`, following relative specifiers with `.js`
  mapped to `.ts`, copied from the workspaces entrypoints
  test.[^workspaces-entrypoints] From `src/index.ts` and `src/testing.ts` it
  asserts that no `src/ui*` file, no `ink`, `react` or `react/*` specifier,
  and no self-reference to `@effected/cli/ui` is reachable; the package's own
  name resolves through its `exports`, so a self-reference is a way into
  `./ui` that no relative edge shows. An `import("<literal>")` is an edge like
  any other, so the
  root may not reach `./ui` even lazily.
- **Part 1, per-file purity, is kept.** The scan still holds every file to
  the `process`, `stdout-write`, `node:` and platform rules. The ui files are
  waived for the import rule, `processStreams.ts` for `process`, and the test
  asserts the waived set is exact.

The test carries its own controls: the walker must resolve the root's real
modules, `./ui` must reach itself, and a synthetic in-memory graph in which a
root file imports `./ui/X.js` must be flagged.

## Alternatives rejected

- **The per-file scan alone.** Rejected: it missed every shape of the
  regression it exists to catch.
- **The scan plus relative-prefix forbids.** Rejected: it misses deeper
  paths and flags unrelated names.
- **Walking only the built `dist` output.** Not adopted now. It would also
  catch a bundler hoisting a shared chunk that imports Ink into the root, but
  the source walk is the gate that fails at the edit that causes it.

## Consequences

The walker now lives in two test files. Promoting it to
`@effected/workspaces/testing` as a shipped `SourceBoundary.reachable` would
remove the copy, and an optional static-only mode would need the specifier
lexer to tag each literal's kind.

[^probe-p4]: Probe P4, run 2026-09-30 over five synthetic source trees.
[^source-boundary]: `../../packages/workspaces/src/SourceBoundary.ts`
[^workspaces-entrypoints]: `../../packages/workspaces/__test__/entrypoints.test.ts`
[^cli-boundary-test]: `../../packages/cli/__test__/boundary.test.ts`
