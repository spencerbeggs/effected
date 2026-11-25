---
type: Module
title: "@effected/testing"
description: The workspace's private, never-published test kit — Depth, Corpus and Growth, the three primitives the kit's own test files share — with zero @effected dependencies of any kind, placed outside the layering so no library can take it at runtime.
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
  - id: depth-ts
    resource: ../../packages/testing/src/Depth.ts
  - id: corpus-ts
    resource: ../../packages/testing/src/Corpus.ts
  - id: growth-ts
    resource: ../../packages/testing/src/Growth.ts
  - id: growth-control
    resource: ../../packages/testing/__test__/Growth.hostile.test.ts
  - id: growth-report
    resource: ../../lib/scripts/growth-report.ts
  - id: layers-json
    resource: ../../lib/configs/layers.json
  - id: turbo-json
    resource: ../../turbo.json
  - id: memfs-seed-test
    resource: ../../packages/memfs/__test__/integration/node-directory-seed.int.test.ts
  - id: owner-design
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-24T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-25T19:35:32Z
integrity:
  generated:
    body: f77e89bd7a1c98e9
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

Because nothing bundles it, `turbo.json`'s `build` inputs exclude
`packages/testing/**`.[^turbo-json] The `build` task hashes every
package's `src/**`, so without the exclusion an edit to the test kit
changed every package's build hash and the pre-test build rebuilt them
all. Revisit the exclusion if the package ever publishes.

## Zero @effected dependencies

**No `@effected/*` edge of any kind — runtime, peer or
dev.**[^package-claude-md] A package whose tests need the kit takes it as
a devDependency (`workspace:*`), and each package's `types:check` chains
over `^types:check` ([the workspace](workspace.md)), so that graph must
stay acyclic. Any edge from the test kit back into the kit closes a
cycle through whichever package it names.

This is the same reasoning that binds [`@effected/memfs`](memfs.md),
recorded in
[the zero-edges decision](../decisions/memfs-zero-effected-edges.md):
a package every other package's tests consume cannot depend on any of
them.

That law binds memfs against the test kit too. `@effected/memfs` takes no
`@effected` dependency of any kind, `@effected/testing` included, so its
one growth check is a ratio written out by hand in its own test, with a
local clock read that the no-clock rule allows by name.[^memfs-seed-test]

## Outside the layering

`lib/configs/layers.json` lists `@effected/testing` under `unconstrained`,
beside the workspace root, the docs site, the scratchpad and the plugin's
tracking package.[^layers-json] Two things follow from that placement:

- The layering check passes. A workspace package the policy does not
  classify is itself an offence, so the package had to be placed
  somewhere.
- **No library can take it at runtime.** An edge into an unconstrained
  package from a layered one, through `dependencies`, `peerDependencies`
  or `optionalDependencies`, is an `intoUnconstrained` offence. The check
  does not read `devDependencies`, which is the only way in.

## What it provides

The package has no assertion library. `Corpus.pin` and
`Growth.assertOrder` throw through `node:assert/strict`, and callers keep
`assert.*` from `@effect/vitest` for everything else.[^package-claude-md]

### Depth

`Depth` reads `EFFECTED_TEST_DEPTH`, which is `sample` or `full`. Unset
means `sample`. Any other value throws, the empty string too, because a
mistyped depth read as `sample` would pass as the full run it was meant
to be.[^depth-ts]

- `Depth.current` is the depth in the environment, read on every access.
- `Depth.pick({ sample, full })` returns the value for the current
  depth. It is what a test uses for a run count or a grid size.
- `Depth.whenFull(run)` runs `run` at full depth and does nothing at
  sample depth. It is for an assertion that is only true of a whole
  corpus and is not a count, such as "this setting changes the number of
  findings".
- `Depth.parse(raw)` is the parser itself.

### Corpus

`Corpus` selects the inputs a corpus test reads.[^corpus-ts]

- `Corpus.select(all, { sample })` returns every entry at full depth and
  only the named entries at sample depth, in corpus order. It refuses a
  sample name the corpus lacks, **at both depths**, so a renamed or
  deleted fixture fails the sample run instead of quietly shrinking it.
  It also refuses an empty sample and a repeated name.
- `Corpus.pin(actual, expected, { label? })` asserts exact equality at
  full depth only. An exact corpus count is a fact about the whole
  corpus, so at sample depth it asserts nothing.

Both take an optional `depth` that overrides the environment, which is
how the package's own tests exercise each side.

### Growth

`Growth` is the one scaling-ratio measurement: `Growth.measure`,
`Growth.assertOrder` and `Growth.cpuNow`.[^growth-ts] A growth check
replaces an absolute elapsed-time ceiling with a ratio between two input
sizes, which holds on a slow runner where a ceiling does not.

Both take `make(size)`, which builds the input and returns the work to
time, so building is not timed. `Growth.measure(make, { from, factor?,
bound })` returns the ratio, both timings and a detail string for a
message. `Growth.assertOrder(make, { from, order })` fails when work grows
faster than `order`; a factor other than 4 needs an explicit `bound`.

The policy is fixed in the package, not chosen per call site:

| Setting | Value |
| --- | --- |
| Sizes compared | `from` and `from × factor`, factor 4 by default |
| Clock | CPU time of the process, user plus system, not wall time |
| Samples per size | the fastest of five, per round |
| Floor | a sample under 5 ms is a batch of repetitions |
| Rounds | up to three, while the ratio is at or over the bound |
| Bound, order 1 (linear reads about 4) | ratio under 10 |
| Bound, order 2 (quadratic reads about 16) | ratio under 32 |

Three properties of the measurement matter to a caller:

- **It stops early on a hopeless ratio.** A ratio at eight times its bound
  is not measured again, and a size that has been sampled for over a
  second is not sampled again in the round. A regression to exponential
  work therefore fails in about the time of two runs of the slow size,
  where three rounds of five samples took minutes. The cost is that a
  first round that noisy fails without a retry; the control's quadratic
  (16 against 10) and cubic (64 against 32) sit well inside eight times.
- **It keeps each run's result.** Every run's return value is stored where
  the rest of the program could read it. A call whose result nothing reads
  is one the optimizer may drop once the loop is hot, and a dropped call
  times as nothing. The work `make` returns should therefore return what
  it computed.
- **It never passes vacuously.** A workload still under the floor after
  200,000 repetitions throws as unmeasurable instead of reporting a ratio
  of clock noise.

**Sizing.** Choose the smallest `from` whose run does real work: tens of
thousands of characters for a scan. A short run is repeated until it can
be timed, so a larger input adds no accuracy, and it makes a quadratic
regression take minutes to report where a small one fails in seconds. A
large input also crosses the size where the memory a run holds costs more
than the run, and that size differs by machine: parsing a megabyte of
`$((` read 4.2 times the quarter megabyte on macOS and 11.9 times on a
Linux runner, against a bound of 10.

**The report.** A pass says nothing of a check's margin. With
`EFFECTED_GROWTH_REPORT` naming a file, or `report` passed in the
options, `Growth.measure` appends each measurement to it as one JSON
line: the call site, the sizing, the bound, the ratio, both timings and
the rounds taken. `lib/scripts/growth-report.ts` prints the checks
nearest their bounds, one row per call site and sizing with its worst
ratio, and the Hostile Tests job writes that table to its log and its
summary on every run, pass or fail.[^growth-report] A check over about
70% of its bound on the runner is the next to fail one run in a few;
measure it at a smaller size.

Its own tests, `Growth.hostile.test.ts`, are the positive control for
every growth check in the kit: a linear workload passes order 1, a
quadratic one fails it, and a cubic one fails order 2.[^growth-control] A
ratio check that a quadratic implementation passes proves nothing, so the
bound is shown to reject a known-bad workload on the same runner, in the
same tier, as the real checks. When that runner cannot tell linear from
quadratic, the control fails and says so. The same file pins that a test
in a hostile file gets the hostile tag's one-minute timeout.

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
[^package-claude-md]: `packages/testing/CLAUDE.md` — the zero-edges rule,
    the no-assertion-library rule and the distinction from the
    `./testing` subpaths.
[^depth-ts]: `packages/testing/src/Depth.ts` — `parse`, `current`, `pick`
    and `whenFull`.
[^corpus-ts]: `packages/testing/src/Corpus.ts` — `select` and `pin`.
[^growth-ts]: `packages/testing/src/Growth.ts` — the constants, `kept`,
    the early exit in `measure`, and the remarks on `Growth`.
[^growth-control]: `packages/testing/__test__/Growth.hostile.test.ts` —
    the linear, quadratic and cubic controls, the early-exit test and the
    hostile-tag timeout test.
[^layers-json]: `lib/configs/layers.json` — the `unconstrained` list.
[^turbo-json]: `turbo.json` — `!$TURBO_ROOT$/packages/testing/**` in the
    `build` task's `inputs`.
[^memfs-seed-test]: `packages/memfs/__test__/integration/node-directory-seed.int.test.ts`
    — the hand-written ratio and the comment that gives the reason.
[^owner-design]: The design the repository owner approved for the test
    kit on 2026-11-24: the package's name, its private status, and the
    three primitives it holds.
[^growth-report]: `lib/scripts/growth-report.ts` — `summarize`, and the `Hostile Tests` job's report step in `.github/workflows/slow-tests.yml`.
