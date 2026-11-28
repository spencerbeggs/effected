---
type: Measurement
title: CI's Run Tests step took 21 minutes, half of the file time in five files
description: "On the Effect 4.1.5 pull request's CI run the Run Tests step took 21 minutes (6 build, 15 vitest over 1006 files); the top five files took about 835 of 1673 seconds of file time, and coverage made the sweeps 2.5 to 3 times slower locally. After the tiers, PR 1444's critical path took 8 minutes warm and 12.9 cold."
status: stable
stale_after: 2027-02-28T00:00:00Z
x-okfit-justifies:
  - ../decisions/vitest-test-tiers.md
tags:
  - testing
  - ci
  - performance
sources:
  - id: pr-1382-run
    resource: GitHub Actions Silk workflow run for PR 1382, the Run Tests step
    last_modified: 2026-11-21T00:00:00Z
  - id: pr-1444-runs
    resource: GitHub Actions Silk and Slow Tests workflow runs for PR 1444, cold and warm
    last_modified: 2026-11-28T00:00:00Z
  - id: vitest-config
    resource: ../../vitest.config.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-28T02:22:45Z
x-okfit-integrity:
  generated:
    body: 3402273a00101e7e
---

# CI's Run Tests step took 21 minutes, half of the file time in five files

## Inputs

The Silk workflow's Run Tests step (`pnpm ci:test`) on the Effect 4.1.5 pull request (PR 1382), on a GitHub-hosted `ubuntu-latest` runner, with coverage on; measured 2026-11-21.[^pr-1382-run]

## Method

Step wall time from the workflow run, split at the turbo build and the vitest run; per-file durations from vitest's report. The coverage cost was measured locally by running the slow files with and without `--coverage.enabled=false`. The fast tier was then run locally with `EFFECTED_TEST_TIER=fast`.

## Results

| Measure | Value |
| --- | --- |
| Run Tests step | 21 min |
| Turbo build inside it | 6 min |
| Vitest run | 15 min, 1006 files |
| Total file time | 1673 s |
| Top five files | about 835 s |
| Coverage slowdown on the sweeps (local) | 2.5–3× |
| Fast tier (local) | 993 files, coverage thresholds met |

## What it rules in or out

Half the file time sits in five files, so moving a small, named set out of the coverage run removes most of the cost, and the fast tier still meets the thresholds without them. That justified [the test tiers](../decisions/vitest-test-tiers.md) and its admission bar of about 20 seconds on a CI runner; every file in `SLOW_TESTS` took that long in this run.[^vitest-config] It does not measure the slow tier's own wall time in CI; the next section does.

## After the tiers, the construct-index job and the narrowed build hash

PR 1444, measured 2026-11-28 on GitHub-hosted `ubuntu-latest` runners, twice: a cold run, because the PR changed `turbo.json`'s build inputs and so every build hash, and a warm run on the next push, which replayed the builds from the hosted turbo cache.[^pr-1444-runs] Step and job wall times come from the Actions API; build hits and vitest durations come from each job's log.

| Job or step | Cold | Warm |
| --- | --- | --- |
| Code Validation job, the critical path | 12 min 54 s | 8 min 3 s |
| Run Tests step | 10 min 24 s (turbo 3 min 39 s, 10 of 56 cached; vitest 6 min 39 s, 1081 files) | 5 min 14 s (56 of 56 cached; vitest 5 min 6 s) |
| Run BATS step | 39 s | 37 s |
| Slow Tests job | 7 min 1 s (13 of 82 cached) | 3 min 36 s (81 of 82 cached) |
| Hostile Tests job | 8 min 7 s (14 of 56 cached) | 5 min 47 s (56 of 56 cached) |
| Construct Index job | 6 min 8 s (47 of 113 cached) | 34 s (111 of 113 cached) |

The Run Tests step went from 21 minutes to about 5 warm and 10 cold. The BATS step had spent about 4.5 of its 4.6 minutes building doc models for the construct-index check; with that check in its own job it takes under 40 seconds. The cold column is the worst case a pull request meets: one that changes a package the `effected` tool loads, which misses every build. These numbers set the time budget in [the test tiers](../decisions/vitest-test-tiers.md#time-budget).

[^pr-1382-run]: GitHub Actions, the Silk workflow's Run Tests step on PR 1382, 2026-11-21.
[^pr-1444-runs]: GitHub Actions, the Silk and Slow Tests workflow runs on PR 1444 at commits 645b08e (cold) and ed21cef (warm), 2026-11-28.
[^vitest-config]: `vitest.config.ts` — the `SLOW_TESTS` doc comment records the admission bar and the run it was measured on.
