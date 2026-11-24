---
type: Decision
title: The vitest suite splits into a fast tier with coverage and a slow tier run beside it
description: "EFFECTED_TEST_TIER=fast (ci:test, coverage and thresholds) excludes vitest.config.ts's SLOW_TESTS at discovery; slow (ci:test:slow, coverage off) runs only them in slow-tests.yml on every pull request in parallel with the Silk workflow, because the tier holds security regression suites."
status: stable
tags:
  - testing
  - ci
  - performance
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: slow-tests-yml
    resource: ../../.github/workflows/slow-tests.yml
  - id: root-package-json
    resource: ../../package.json
generated:
  by: "okfit/claude-code"
  at: 2026-11-24T03:44:35Z
integrity:
  generated:
    body: 5f7dcdc4db1b41fc
  verified:
    by: human:spencer
    at: 2026-11-21T22:25:48Z
    content: 9a4c2c352325d795
verified:
  - by: human:spencer
    at: 2026-11-21T19:47:49Z
  - by: human:spencer
    at: 2026-11-21T22:25:48Z
---

# The vitest suite splits into a fast tier with coverage and a slow tier run beside it

## Context

The Silk workflow's Run Tests step took 21 minutes, and a handful of CPU-heavy files dominated it; see [the CI test-duration measurement](../measurements/ci-test-duration.md). Those files are property and fuzz sweeps, packed-install e2es and config-reload tests, and v8 coverage instrumentation made the sweeps two to three times slower while adding no coverage the rest of the suite lacked.

## Decision

`EFFECTED_TEST_TIER` splits the suite, and `vitest.config.ts`'s `SLOW_TESTS` list names the slow files by repo-relative path.[^vitest-config]

- **`fast`** — what `pnpm ci:test` runs, with coverage and its thresholds. Each project excludes its slow files from **discovery**, through `test.exclude`.
- **`slow`** — what `pnpm ci:test:slow` runs first, with `--coverage.enabled=false`. Each project includes only its slow files outside `TIMING_TESTS`, and a project with none is dropped.[^root-package-json]
- **`timing`** — what `pnpm ci:test:slow` runs after `slow`, coverage off, with `fileParallelism: false`. It includes only `TIMING_TESTS`, the slow files that bound a timing growth ratio or a wall-clock ceiling (the shell package's hostile and `allCommands` units, and markdown-lint's hostile-input ceilings). A file that measures time belongs there whatever its own run time. Run in parallel with the other slow files, those failed two of four Slow Tests runs, each just past its bound, so they now measure with no other file on the runner (#1387). Every `TIMING_TESTS` entry must also be in `SLOW_TESTS`, or the config refuses to load.
- **Unset** — every local run — runs everything.

`.github/workflows/slow-tests.yml` runs the slow tier on every pull request to `main`, on pushes to `main` and on dispatch, as its own job beside the Silk workflow rather than after it, so a pull request waits for the slower of the two rather than their sum.[^slow-tests-yml]

A file is admitted to `SLOW_TESTS` when it takes about 20 seconds or more on a CI runner. The config refuses to load when a listed file no longer exists, so a rename cannot silently drop a file from both tiers. Any other `EFFECTED_TEST_TIER` value is refused too.

## Why discovery, not a tag filter

`@vitest-agent/plugin` treats a tag-filtered run (`--tags-filter`) as a partial run and neutralizes the coverage thresholds (`Coverage thresholds skipped: partial run`). A fast tier selected by tag would therefore lose its coverage gate without failing. Excluding the files from discovery keeps the fast run a full run, so its thresholds still apply.

## Why every pull request, not nightly

The slow tier holds the security regression suites: shell, glob and lockfile hostility. A nightly schedule would let a pull request that reopens one of those holes merge green and fail the next morning. Running in parallel keeps the gate on the pull request at no wall-clock cost beyond the slower job.

## Alternatives rejected

- **Sharding the whole suite.** It shortens wall time but keeps the instrumentation cost on every slow file, and a sharded run is also a partial run to vitest-agent, so the thresholds would go too.
- **Turning coverage off everywhere.** It removes the gate the fast tier exists to keep.

[^vitest-config]: `vitest.config.ts` — `SLOW_TESTS`, `testTier()`, the missing-file check and the per-project `exclude`/`include` in `buildProject`.
[^slow-tests-yml]: `.github/workflows/slow-tests.yml` — the `Slow Tests` job and its header comment.
[^root-package-json]: `package.json` — `ci:test` sets `EFFECTED_TEST_TIER=fast`; `ci:test:slow` runs `EFFECTED_TEST_TIER=slow` and then `EFFECTED_TEST_TIER=timing`, each with `--coverage.enabled=false`.
