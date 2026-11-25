---
type: Measurement
title: CI's Run Tests step took 21 minutes, half of the file time in five files
description: "On the Effect 4.1.5 pull request's CI run the Run Tests step took 21 minutes (6 build, 15 vitest over 1006 files); the top five files took about 835 of 1673 seconds of file time, and coverage made the sweeps 2.5 to 3 times slower locally."
status: stable
stale_after: 2027-02-21T00:00:00Z
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
  - id: vitest-config
    resource: ../../vitest.config.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-21T19:43:06Z
x-okfit-integrity:
  generated:
    body: 05817628db9c995a
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

Half the file time sits in five files, so moving a small, named set out of the coverage run removes most of the cost, and the fast tier still meets the thresholds without them. That justified [the test tiers](../decisions/vitest-test-tiers.md) and its admission bar of about 20 seconds on a CI runner; every file in `SLOW_TESTS` took that long in this run.[^vitest-config] It does not measure the slow tier's own wall time in CI, which the first runs of `slow-tests.yml` will record.

[^pr-1382-run]: GitHub Actions, the Silk workflow's Run Tests step on PR 1382, 2026-11-21.
[^vitest-config]: `vitest.config.ts` — the `SLOW_TESTS` doc comment records the admission bar and the run it was measured on.
