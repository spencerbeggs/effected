---
type: Measurement
title: Sampling markdown-lint's corpus cut its local file time from 1,675 s to 160 s, short of the 240 s CI gate's proportion
description: "On PR 1414 the Run Tests step took 38 minutes, 3,640 of 4,186 s of file time in markdown-lint. An 11-fixture corpus sample ran in 160 s against 1,675 s locally (9.6%, where the 240 s CI gate needs 6.6%) with source coverage within a point of the full corpus; on PR 1419 the Run Tests step then took 9 min 53 s (3 min 5 s build, 401 s vitest) with markdown-lint at 252 s."
status: draft
stale_after: 2027-02-25T00:00:00Z
x-okfit-justifies:
  - ../decisions/vitest-test-tiers.md
tags:
  - testing
  - ci
  - performance
sources:
  - id: pr-1414-run
    resource: GitHub Actions Silk workflow run for PR 1414, job 45512991811, the Run Tests step and the Slow Tests job
    last_modified: 2026-11-24T00:00:00Z
  - id: local-runs
    resource: local vitest runs on the branch that added the corpus sample, one machine
    last_modified: 2026-11-24T00:00:00Z
  - id: pr-1419-runs
    resource: GitHub Actions runs for PR 1419, the Silk and Slow Tests workflows on commits 2b20b0008, 0a4462447 and 886319109
    last_modified: 2026-11-25T00:00:00Z
  - id: choose-sample
    resource: ../../packages/markdown-lint/__test__/helpers/choose-sample.ts
  - id: corpus-sample
    resource: ../../packages/markdown-lint/__test__/helpers/corpus-sample.ts
  - id: owner-design
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-24T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-25T20:25:49Z
x-okfit-integrity:
  generated:
    body: 3afa9b312a5a93e6
---

# Sampling markdown-lint's corpus cut its local file time from 1,675 s to 160 s, short of the 240 s CI gate's proportion

## Inputs

Three sets of numbers, measured 2026-11-24.

- **The CI baseline.** The Silk workflow's Run Tests step (`pnpm ci:test`) and the Slow Tests job on PR 1414, on GitHub-hosted `ubuntu-latest` runners, coverage on in the first and off in the second, over 1,063 test files.[^pr-1414-run]
- **The local before and after.** `@effected/markdown-lint`'s project alone, on one machine, with the whole 437-fixture corpus and then with the committed 11-fixture sample.[^local-runs][^corpus-sample]
- **The hostile tier, locally.** Every `.hostile.test.ts` file then in the tree, one file at a time, coverage off.[^local-runs]

## Method

Step and job wall time from the workflow run, split at the turbo build and the vitest run; per-file durations from vitest's report, summed.

The local before and after are one command, run from the repository root, with and without the sample:

```sh
CI=true EFFECTED_TEST_TIER=fast pnpm exec vitest run --project @effected/markdown-lint
```

Coverage of the package's own source was read at both depths with the command in [the markdown-lint module](../modules/markdown-lint.md#testing), which narrows the report to `packages/markdown-lint/src/**`. The hostile tier was run twice with `pnpm test:hostile`.

## Results

The CI baseline, PR 1414:

| Measure | Value |
| --- | --- |
| Run Tests step | 38 min |
| Turbo build inside it | 6 min |
| Vitest run | 29 min |
| Summed file time | 4,186 s |
| markdown-lint's share | 3,640 s (87%) |
| Slow Tests job | 9.5 min, 3 min of it tests |

markdown-lint locally, the same command at each depth:

| Measure | Full corpus | Sample |
| --- | --- | --- |
| Fixtures compared on | 437 | 11 |
| Summed file time | 1,675 s | 160 s |
| Share of the full corpus's time | 100% | 9.6% |
| Source coverage, lines | 99.51% | 99.36% |
| Source coverage, branches | 94.00% | 93.38% |

The hostile tier locally: 335 tests across 13 packages in about three minutes (3 min 5 s and 3 min 8 s). More packages have gained hostile files since, 30 files in all, and the whole tier has not been timed again, so that count and time are a floor.

## The pull request's own runs

Three runs on PR 1419, on GitHub-hosted `ubuntu-latest` runners with four cores, measured 2026-11-25.[^pr-1419-runs] The first is the branch as it was opened. The second and third follow three changes made because of the first: each tier builds only the packages its tests read built output from, the hostile tier has a job of its own, and in the fast tier a project's test files share a process.

| Measure | PR 1414 baseline | PR 1419, first run | PR 1419, after the three changes |
| --- | --- | --- | --- |
| Run Tests step | 38 min | about 16 min 40 s, the build and the vitest run | 9 min 53 s |
| Turbo build inside it | 6 min | 6 min 8 s, 41 packages, 0 of 82 tasks cached | 3 min 5 s, 12 packages, 41 of 56 tasks cached |
| Vitest run | 29 min | 630 s | 401 s |
| Share of worker time loading modules | not read | 38% | 17% |
| Summed file time | 4,186 s | 830 s | 761 s |
| markdown-lint's share | 3,640 s | 285 s | 252 s |
| Slow tier | 9.5 min job, 3 min of it tests | 14 min 39 s job: 4 min 32 s build, 149 s slow, 347 s hostile | 6 min 26 s job: 3 min 16 s build, 140 s tests |
| Hostile tier | in the job above | in the job above | 7 min 52 s job: 2 min 23 s build, 300 s tests |

The Code Validation job that holds the Run Tests step took 16 min 10 s in the second run. Two minutes of it come before the tests (58 s of checkout) and 4 min 20 s after, in the shell test step, which this branch does not change.

A third run, at commit `886319109` after main was merged in, took 6 min 56 s for the step: a 2 min 24 s build with nothing cached and 268 s of vitest, with 504 s of summed file time and markdown-lint at 164 s. It is the same test configuration as the second, so the spread between the two (761 s against 504 s for the same tests) is the runner; that merge also brought vitest 5.1.2.

Against the budget: the Run Tests step is inside 15 minutes and the vitest phase, at 6 min 41 s and 4 min 28 s, is inside 7. markdown-lint meets its 240 s gate on the faster runner (164 s) and misses it by 12 s on the slower (252 s).

Each of the first three hostile runs on the Linux runner failed one growth check that passes on macOS, a different one each time. Two measured across a size where the memory a run holds costs more than the run, and one timed a matcher that answers from a cache. The Hostile Tests job now prints the checks nearest their bounds on every run, so the next one is read before it fails.

## The budget

The stated budget for the pull request's Run Tests step is 15 minutes, with the vitest phase at 7 minutes or less.[^owner-design] The arithmetic behind it: the baseline's file time outside markdown-lint is about 546 s, and with markdown-lint at 240 s the sum is about 786 s, which is 5.5 to 7 minutes of vitest at the parallelism the measured runs showed, beside 6 minutes of build and the step's setup. The gate for the sample was therefore markdown-lint at 240 s or less of summed file time in CI, with one rule above it: the sample must hold the package's source coverage within one point of the full corpus, and coverage wins if the two conflict.

## What it rules in or out

**The 240 s gate was not met by the local proportion.** 240 s of the 3,640 s baseline is 6.6%; the sample runs at 9.6% of the full corpus's time. Scaled to the CI baseline that is about 350 s for markdown-lint, not 240 s.

The corpus is not the whole cost. Each rule's hand-written inputs run at every depth, and so do the tests that never read the corpus, and together they are what is left when the corpus share is small. Coverage did not force the gap: the sample is within one point on lines and branches, and a wider sample of 41 fixtures roughly doubled the run for ten more branches of 3,267.[^choose-sample][^local-runs] The sample is small for that reason, not to meet the gate.

**The pull request's own runs are the real measurement**, and they are in [the next section](#the-pull-requests-own-runs). The local numbers above come from one machine, and the baseline's parallelism and runner differ from it.

It rules in the depth axis of [the test tiers](../decisions/vitest-test-tiers.md): a fixed sample takes about nine tenths of the package's file time out of the pull request run while keeping its source coverage, and the full corpus still runs before a release. It rules in running the hostile tier on every pull request at about three minutes of tests locally and five on the runner. The turbo build was 6 minutes of the step until each tier built only what its tests read; it is 3 minutes of the step when a source file has changed, and that remainder is not examined here.

[^pr-1414-run]: GitHub Actions, the Silk workflow's Run Tests step and the Slow Tests job on PR 1414, job 45512991811.
[^local-runs]: Local runs on the branch that added the corpus sample, 2026-11-24; the commands are in Method.
[^choose-sample]: `packages/markdown-lint/__test__/helpers/choose-sample.ts` — the header comment records the coverage at both depths and what the wider sample cost.
[^corpus-sample]: `packages/markdown-lint/__test__/helpers/corpus-sample.ts` — the committed sample.
[^owner-design]: The design the repository owner approved on 2026-11-24: the 15-minute step budget, the 7-minute vitest budget, the 240 s gate and the one-point coverage rule above it.
[^pr-1419-runs]: GitHub Actions, the Silk workflow's Run Tests step and the Slow Tests workflow's jobs on PR 1419, at commits `2b20b0008`, `0a4462447` and `886319109`.
