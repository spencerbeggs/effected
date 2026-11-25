---
type: Module
title: "@effected/testing"
description: The workspace's private, never-published test kit — Depth, Corpus and Growth, the three primitives the kit's own test files share — with zero @effected dependencies of any kind.
status: draft
kind: package
resource: ../../packages/testing
tags:
  - testing
  - architecture
sources:
  - id: package-json
    resource: ../../packages/testing/package.json
  - id: package-claude-md
    resource: ../../packages/testing/CLAUDE.md
  - id: owner-design
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-24T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-25T01:56:24Z
integrity:
  generated:
    body: 519bf6ac2ba325d8
---

# @effected/testing

`@effected/testing` is the workspace's private test kit, at
`packages/testing`. It holds three primitives the kit's own test files
share — `Depth`, `Corpus` and `Growth` — so that how much input a test
reads, which part of a corpus it runs, and how a scaling claim is
measured are each decided in one place instead of once per
package.[^owner-design]

Which run a test file lands in is
[the test tiers decision](../decisions/vitest-test-tiers.md); how the
kit's tests are written is
[the testing standards](../conventions/testing-standards.md). This
concept covers only the package and what it exports.

## Private and never published

The manifest is `"private": true` with no `publishConfig`.[^package-json]
Every source manifest in this repository is private, and publishability is
`publishConfig.access === "public"`, so it is the missing `publishConfig`
that keeps this package off npm. Three things follow:

- It is not a member of the published `effected` catalog.
- It is not one of the kit's publishable packages, so it does not count
  toward the roster in [the Project concept](../project.md).
- It is workspace-only test support. It may publish later; nothing today
  depends on that.[^owner-design]

It has a `types:check` script and its own tests, and no
build.[^package-json] Workspace links resolve to a sibling's `src/`, so a
package that depends on it never needs anything built first.

## Zero @effected dependencies

**No `@effected/*` edge of any kind — runtime, peer or
dev.**[^package-claude-md] Every package takes this one as a
devDependency (`workspace:*`), and each package's `types:check` chains
over `^types:check` ([the workspace](workspace.md)), so that graph must
stay acyclic. Any edge from the test kit back into the kit closes a
cycle through whichever package it names.

This is the same reasoning that binds [`@effected/memfs`](memfs.md),
recorded in
[the zero-edges decision](../decisions/memfs-zero-effected-edges.md):
a package every other package's tests consume cannot depend on any of
them.

## What it provides

### Depth

`Depth` reads `EFFECTED_TEST_DEPTH`, which is `sample` or `full`. Unset
means `sample`. Any other value is refused, so a typo cannot silently
run the wrong depth.[^owner-design]

- `Depth.pick({ sample, full })` returns the value for the current
  depth. It is what a test uses for a run count or a grid size.
- `Depth.whenFull(run)` runs `run` at full depth only.

### Corpus

`Corpus` selects the inputs a corpus test reads.[^owner-design]

- `Corpus.select(all, { sample })` returns every entry at full depth and
  only the named entries at sample depth. It refuses a sample name the
  corpus lacks, **at both depths**, so a renamed or deleted fixture
  fails the sample run instead of quietly shrinking it.
- `Corpus.pin(actual, expected)` asserts exact equality at full depth
  only. An exact corpus count is a fact about the whole corpus, so at
  sample depth it asserts nothing.

### Growth

`Growth` is the one scaling-ratio measurement: `Growth.measure`,
`Growth.assertOrder` and `Growth.cpuNow`.[^owner-design] A growth check
replaces an absolute elapsed-time ceiling with a ratio between two input
sizes, which holds on a slow runner where a ceiling does not.

The policy is fixed in the package, not chosen per call site:

| Setting | Value |
| --- | --- |
| Sizes compared | `n` and `4n` |
| Clock | CPU time, not wall time |
| Samples per size | best of five |
| Floor | a sample must reach 5 ms |
| Rounds | up to three |
| Bound, linear | ratio under 10 |
| Bound, quadratic by design | ratio under 32 |

Its own tests are the positive control: a quadratic workload must fail
the linear check. A ratio check that a quadratic implementation passes
proves nothing, so the bound is shown to reject a known-bad workload on
the same runner that runs the real checks.

## Not the ./testing subpaths

Several kit packages export a `./testing` subpath, for example
`@effected/cli-kit/testing` ([cli-kit](cli-kit.md)). Those are
**consumer-facing** test helpers for the package that exports them: they
publish with it and a downstream application imports them.
`@effected/testing` is the opposite on both counts — it serves this
workspace's own tests and never publishes.[^package-claude-md] The names
collide; the artifacts do not.

[^package-json]: `packages/testing/package.json` — `"private": true`, no
    `publishConfig`, a `types:check` script and no `build` script.
[^package-claude-md]: `packages/testing/CLAUDE.md` — the zero-edges rule
    and the distinction from the `./testing` subpaths.
[^owner-design]: The design the repository owner approved for the test
    kit on 2026-11-24: the package's name, its private status, and the
    `Depth`, `Corpus` and `Growth` contracts.
