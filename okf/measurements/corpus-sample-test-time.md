---
type: Measurement
title: Sampling markdown-lint's corpus cut its local file time from 1,675 s to 160 s, short of the 240 s CI gate's proportion
description: "On PR 1414 the Run Tests step took 38 minutes, 3,640 of 4,186 s of file time in markdown-lint. An 11-fixture corpus sample ran in 160 s against 1,675 s locally (9.6%, where the 240 s CI gate needs 6.6%) with source coverage within a point of the full corpus; the first CI run of the sample is not yet recorded."
status: draft
stale_after: 2027-02-25T00:00:00Z
justifies:
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
  at: 2026-11-25T13:41:08Z
integrity:
  generated:
    body: 2b059b72cc8f13c2
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

## The budget

The stated budget for the pull request's Run Tests step is 15 minutes, with the vitest phase at 7 minutes or less.[^owner-design] The arithmetic behind it: the baseline's file time outside markdown-lint is about 546 s, and with markdown-lint at 240 s the sum is about 786 s, which is 5.5 to 7 minutes of vitest at the parallelism the measured runs showed, beside 6 minutes of build and the step's setup. The gate for the sample was therefore markdown-lint at 240 s or less of summed file time in CI, with one rule above it: the sample must hold the package's source coverage within one point of the full corpus, and coverage wins if the two conflict.

## What it rules in or out

**The 240 s gate was not met by the local proportion.** 240 s of the 3,640 s baseline is 6.6%; the sample runs at 9.6% of the full corpus's time. Scaled to the CI baseline that is about 350 s for markdown-lint, not 240 s.

The corpus is not the whole cost. Each rule's hand-written inputs run at every depth, and so do the tests that never read the corpus, and together they are what is left when the corpus share is small. Coverage did not force the gap: the sample is within one point on lines and branches, and a wider sample of 41 fixtures roughly doubled the run for ten more branches of 3,267.[^choose-sample][^local-runs] The sample is small for that reason, not to meet the gate.

**The first CI run on the pull request is the real measurement, and it is not yet recorded here.** Everything after the baseline is local, on one machine, and the baseline's parallelism and runner differ from it. Record the Run Tests step, its vitest phase and markdown-lint's summed file time from that run, then judge the 15-minute and 7-minute budget against them.

It rules in the depth axis of [the test tiers](../decisions/vitest-test-tiers.md): a fixed sample takes about nine tenths of the package's file time out of the pull request run while keeping its source coverage, and the full corpus still runs before a release. It rules in running the hostile tier on every pull request at about three minutes of tests. It does not measure the turbo build, which is 6 minutes of the step and of the Slow Tests job alike and is untouched.

[^pr-1414-run]: GitHub Actions, the Silk workflow's Run Tests step and the Slow Tests job on PR 1414, job 45512991811.
[^local-runs]: Local runs on the branch that added the corpus sample, 2026-11-24; the commands are in Method.
[^choose-sample]: `packages/markdown-lint/__test__/helpers/choose-sample.ts` — the header comment records the coverage at both depths and what the wider sample cost.
[^corpus-sample]: `packages/markdown-lint/__test__/helpers/corpus-sample.ts` — the committed sample.
[^owner-design]: The design the repository owner approved on 2026-11-24: the 15-minute step budget, the 7-minute vitest budget, the 240 s gate and the one-point coverage rule above it.
