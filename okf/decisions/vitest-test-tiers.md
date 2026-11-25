---
type: Decision
title: The vitest suite splits into a fast tier with coverage and slow, hostile and full tiers run beside it
description: "EFFECTED_TEST_TIER takes fast, slow, hostile and full. fast (ci:test, coverage and thresholds) excludes SLOW_TESTS and every .hostile.test.ts file at discovery; slow (ci:test:slow) and hostile (ci:test:hostile), coverage off, each run in a job of its own on every pull request beside the Silk workflow; full (ci:test:full) runs the .parity, .corpus and .property files at full depth on the release pull request. A file's kind is its suffix, and an unset tier runs everything but the hostile files. A tier builds only the packages its tests read built output from, and in the fast tier a project's files share a process."
status: stable
tags:
  - testing
  - ci
  - performance
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: test-tiers
    resource: ../../lib/scripts/test-tiers.ts
  - id: slow-tests-yml
    resource: ../../.github/workflows/slow-tests.yml
  - id: full-tests-yml
    resource: ../../.github/workflows/full-tests.yml
  - id: full-test-projects
    resource: ../../lib/scripts/full-test-projects.ts
  - id: test-kinds-test
    resource: ../../__test__/test-kinds.test.ts
  - id: growth-control
    resource: ../../packages/testing/__test__/Growth.hostile.test.ts
  - id: root-package-json
    resource: ../../package.json
  - id: test-builds
    resource: ../../lib/scripts/test-builds.ts
  - id: vitest-setup
    resource: ../../vitest.setup.ts
  - id: owner-design
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-24T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-25T19:35:42Z
integrity:
  generated:
    body: e2831e6dc92a5ae3
  verified:
    by: human:spencer
    at: 2026-11-25T13:46:34Z
    content: 5cd54b7a00dcf2a1
verified:
  - by: human:spencer
    at: 2026-11-21T19:47:49Z
  - by: human:spencer
    at: 2026-11-21T22:25:48Z
  - by: human:spencer
    at: 2026-11-24T06:19:30Z
  - by: human:spencer
    at: 2026-11-25T13:46:34Z
---

# The vitest suite splits into a fast tier with coverage and slow, hostile and full tiers run beside it

## Context

The Silk workflow's Run Tests step took 21 minutes, and a handful of CPU-heavy files dominated it; see [the CI test-duration measurement](../measurements/ci-test-duration.md). Those files are property and fuzz sweeps, packed-install e2es and config-reload tests, and v8 coverage instrumentation made the sweeps two to three times slower while adding no coverage the rest of the suite lacked.

Two things then grew past that split. The step reached 38 minutes with 87% of the file time in one package's parity corpus, and the files that asserted an elapsed time failed two Slow Tests runs in four when another file shared the runner (#1387); see [the corpus-sample measurement](../measurements/corpus-sample-test-time.md). The first form of this decision placed those timing files with a second path list and a `timing` tier; a file's name now places it.

## Decision

`EFFECTED_TEST_TIER` selects a run. It takes `fast`, `slow`, `hostile` and `full`; any other value is refused. `lib/scripts/test-tiers.ts` holds the rules and `vitest.config.ts` wires them to project discovery.[^test-tiers]

- **`fast`** — what `pnpm ci:test` runs, with coverage and its thresholds. Each project excludes its `SLOW_TESTS` files and every hostile file (`**/*.hostile.test.{ts,tsx}`) from **discovery**, through `test.exclude`. The depth-aware files run here at sample depth.
- **`slow`** — what `pnpm ci:test:slow` runs, with `--coverage.enabled=false`. Each project includes only its `SLOW_TESTS` files, and a project with none is dropped.[^root-package-json]
- **`hostile`** — what `pnpm ci:test:hostile` runs, coverage off, with `fileParallelism: false`. It includes every `*.hostile.test.ts` file, selected by suffix, and a project with none is dropped. These files bound how work grows with its input, and a growth ratio needs the runner to itself: run in parallel with the other slow files, they failed two of four Slow Tests runs, each just past its bound (#1387).
- **`full`** — what `pnpm ci:test:full` runs, coverage off. Each project includes only its depth-aware files, the ones named `.parity.test.ts`, `.corpus.test.ts` or `.property.test.ts`, and gets `EFFECTED_TEST_DEPTH=full` in its test environment.
- **Unset** — every local run — runs everything **except the hostile files**, at sample depth. `pnpm test:hostile` runs the hostile tier and `pnpm test:full` the full tier, each with coverage off.[^root-package-json]

A tier drops a project that has none of its files, so `--project` naming such a package matches nothing and vitest stops with its no-projects error instead of passing a run of zero tests. `EFFECTED_TEST_DEPTH` is `sample` or `full`; unset is `sample`, and the config parses it on every run, so a mistyped depth stops a run whose files never read it.[^vitest-config]

### A file's kind is its suffix

`SLOW_TESTS` stays a path list in `vitest.config.ts`: nine files that are slow by nature (packed-install e2es, reload tests, bundle tests and sweeps), each admitted for taking about 20 seconds or more on a CI runner. The config refuses to load when a listed file no longer exists, so a rename cannot silently drop a file from both tiers, and when a listed file is a hostile file, because its suffix already places it and it would run twice.[^test-tiers]

Every other placement comes from the file's name, and the root `__test__/test-kinds.test.ts` holds the names to what the files do: a test file that reaches `Growth` from [`@effected/testing`](../modules/testing.md) is named `.hostile.test.ts`, one that reaches `Depth` or `Corpus` carries a depth-aware suffix, and a file with either kind of suffix reaches the matching API. "Reaches" follows a file's relative imports inside its package's `__test__/`, so a rule test that reads its corpus through a shared harness is depth-aware.[^test-kinds-test] A file therefore cannot use the harness and sit in the wrong run, which is the guarantee the second path list gave. What a contributor does with the suffixes is in [the testing standards](../conventions/testing-standards.md).

### The hostile tag

`vitest.config.ts` gives every hostile file the `hostile` tag, which carries a 60-second test timeout. A growth check repeats its workload until it can be timed, which can outlast vitest's five-second default; the bound is the ratio, and the timeout only stops a reintroduced exponential from hanging the run.

The tag reaches a file only because the config passes `discoverStrategy: strategy` to `AgentPlugin(...)` as well as to `AgentPlugin.discover(strategy)`.[^vitest-config] `discover` only builds the projects. The transform that tags each test file reads the plugin's own `discoverStrategy` option, which defaults to a fresh default strategy that knows nothing of the file-name kinds. Without the option no hostile file was tagged, every test in one kept the five-second default, and a check failed on a slow run for a reason that was not its ratio. `Growth.hostile.test.ts` pins it: a test in a hostile file must have a timeout of 60,000 ms.[^growth-control]

### Where each tier runs

`.github/workflows/slow-tests.yml` runs two jobs on every pull request to `main`, on pushes to `main` and on dispatch: `Slow Tests` runs `pnpm ci:test:slow` and `Hostile Tests` runs `pnpm ci:test:hostile`. Both run beside the Silk workflow rather than after it, so a pull request waits for the slowest of the three rather than their sum. The hostile tier has a job of its own so that it neither waits for the slow tier's larger build nor goes unreported when a slow test fails. That job also prints the growth checks nearest their bounds, from the report [the test kit](../modules/testing.md#growth) writes, since a check's margin differs by machine and a pass does not show it.[^slow-tests-yml]

`.github/workflows/full-tests.yml` runs the full tier. On a pull request to `main` its one job runs only when the head branch is `changeset-release/main` and the pull request comes from this repository. `lib/scripts/full-test-projects.ts` selects the packages: those the pull request changes, plus every package that depends on one through `dependencies`, `peerDependencies` or `optionalDependencies`, kept when they own a depth-aware test file.[^full-test-projects] The release pull request's diff is version bumps and changelogs, so a changed path under a package means the package is in the release, and a dependent is included because a release of a parser can break the parity of the linter built on it. On dispatch it runs the packages named, or every package with depth-aware tests when none is named; a name that is unknown or has no depth-aware tests fails the run. It is one job, so a required check named `Full Tests` reports skipped on an ordinary pull request.[^full-tests-yml] The workflow blocks a release only once `Full Tests` is a required check in the repository ruleset, which is a repository setting and not something the workflow sets.

### What each tier builds

Workspace links resolve to source, so a test needs a build only when it reads built output, and only of the package it reads. `lib/scripts/test-builds.ts` holds the list, `READS_OWN_BUILD`, and both the CI scripts and the pre-test build in `vitest.setup.ts` take their turbo filters from it.[^test-builds][^vitest-setup]

- The fast, hostile and full tiers build the twelve listed packages alone, with no dependency closure.
- The slow tier, and a run with no tier, which includes the slow files, add `@effected/plugin...`: the packed-install e2e packs the plugin with everything it depends on.

The list was measured, not reasoned. With every `dist/prod` removed and the pre-test build off (`EFFECTED_TEST_NO_BUILD=1`), the fast tier failed in eleven packages; with those built, one plugin test still failed for want of the engine's build; with twelve built, the fast, hostile and full tiers pass from a clean tree. The fast tier had built the plugin's whole closure, 41 packages, which took about six minutes on a runner whenever a source file had changed. A runner starts from a clean checkout, so a test that comes to read a build the list does not name fails there rather than passing on a stale one.

### Which files share a process

A process per test file is vitest's default, and it was 38% of the fast tier's worker time on a runner: about a thousand files each loading the same modules. `isolatesFiles` in `lib/scripts/test-tiers.ts` turns it off per project.[^test-tiers]

- In the fast tier and in a run with no tier, a project's files share a process.
- `@effected/bundler` and `@effected/cli-kit` keep a process per file. Their tests assert on what a fresh process has or has not loaded, such as Ink not being loaded until a screen needs it. They are the two projects that failed when isolation was off everywhere.
- The hostile, slow and full tiers keep a process per file. A growth check reads the CPU time of its own process, and in the other two the time saved is not worth the risk.

A test that passes only because an earlier file left state behind is the cost of sharing. The fast tier passed with its file order shuffled under two seeds when the rule was set; a project whose tests come to depend on a fresh process joins `NEEDS_FRESH_PROCESS`.

## Why discovery, not a tag filter

`@vitest-agent/plugin` treats a tag-filtered run (`--tags-filter`) as a partial run and neutralizes the coverage thresholds (`Coverage thresholds skipped: partial run`). A fast tier selected by tag would therefore lose its coverage gate without failing. Excluding the files from discovery keeps the fast run a full run, so its thresholds still apply. The config does tag files by kind (`hostile`, which carries the timeout, and `parity`, `corpus` and `property`), but no tier is selected by a tag.

The same reasoning shapes the depth axis. The parity corpus was not moved to a tier of its own: the files stay in the fast run and read fewer inputs there, so each rule's hand-written inputs still run on every pull request under coverage.

## Why every pull request, not nightly

The hostile tier holds the security regression suites: shell, glob and lockfile hostility. A nightly schedule would let a pull request that reopens one of those holes merge green and fail the next morning. Running in parallel keeps the gate on the pull request at no wall-clock cost beyond the slower job.

The full tier is the exception, and deliberately: it proves parity over a whole corpus, where the sample already catches a broken rule or parser path on the pull request. What the full corpus alone would catch is found at the release pull request, before anything publishes.

## Alternatives rejected

- **Sharding the whole suite.** It shortens wall time but keeps the instrumentation cost on every slow file, and a sharded run is also a partial run to vitest-agent, so the thresholds would go too.
- **Turning coverage off everywhere.** It removes the gate the fast tier exists to keep.
- **A path list for the timing files.** It worked while there were three. A list cannot stop a new growth check being written in a file that runs beside others; a suffix that a structural test enforces can.
- **A nightly full run, or filing an issue when one fails.** The owner chose the release-pull-request gate plus dispatch.[^owner-design]

[^vitest-config]: `vitest.config.ts` — `SLOW_TESTS`, the `hostile` tag and its timeout, `discoverStrategy: strategy`, `fileParallelism: false` under the hostile tier, and the per-project `exclude`/`include`/`env` in `buildProject`.
[^test-tiers]: `lib/scripts/test-tiers.ts` — `TIERS`, `HOSTILE_GLOB`, `DEPTH_SUFFIXES`, `parseTier`, `parseDepth`, `validateLists`, `projectSelection`, `NEEDS_FRESH_PROCESS` and `isolatesFiles`.
[^slow-tests-yml]: `.github/workflows/slow-tests.yml` — the `Slow Tests` job and its header comment.
[^full-tests-yml]: `.github/workflows/full-tests.yml` — the `Full Tests` job, its `if:` and its header comment.
[^full-test-projects]: `lib/scripts/full-test-projects.ts` — `affectedProjects` and `requestedProjects`.
[^test-kinds-test]: `__test__/test-kinds.test.ts` — the four rules and `ALLOWED_CLOCKS`.
[^growth-control]: `packages/testing/__test__/Growth.hostile.test.ts` — "gives a test in a hostile file a one-minute timeout".
[^owner-design]: The design the repository owner approved on 2026-11-24: the full run gates the release pull request and runs on dispatch, with no nightly schedule.
[^root-package-json]: `package.json` — `ci:test` sets `EFFECTED_TEST_TIER=fast`; `ci:test:slow`, `ci:test:hostile`, `ci:test:full`, `test:hostile` and `test:full` each set their tier with `--coverage.enabled=false`, and each `ci:test*` script first builds its tier's packages through `lib/scripts/test-builds.ts`.
[^test-builds]: `lib/scripts/test-builds.ts` — `READS_OWN_BUILD`, `buildFilters` and `buildCommand`.
[^vitest-setup]: `vitest.setup.ts` — the pre-test build and `EFFECTED_TEST_NO_BUILD`.
