---
type: Runbook
title: Regenerate the GitHub Action template repository
description: Bring savvy-web/github-action-template back into conformance with the canonical action shape in one coherent commit, rather than incremental patches that leave the old and new shapes coexisting.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-17T04:41:11Z
integrity:
  generated:
    body: f012f8aca114d1d5
---

# Regenerate the GitHub Action template repository

## Trigger

The template repository (`savvy-web/github-action-template`) has drifted
from [the canonical action shape](../conventions/github-action-canon.md) —
whether because the canon gained a new resolved rule, or because an audit
found the template's own claims about itself do not hold, per
[a clean issue tracker is not evidence it works](../gotchas/action-zero-open-issues-not-readiness.md).

## The template repo

The template is the executable copy of the canon: when the two disagree,
the canon is the register and the template is the bug, unless the
template's divergence is itself a new incident that amends the canon
first. Read the repository to see the scaffold's current shape, but treat
any claim it makes about its own gates (that a build runs, that tests
pass, that `dist/` is committed) as unverified until it is re-audited —
one audit found a template advertising exactly these gates while none of
them were wired up: no committed `dist/`, no CI workflow running test,
lint, typecheck, or a freshness check, and `act-test.yml` targeting a
local build that did not exist.

## Regeneration contract

Land the regeneration as **one coherent commit**, never as incremental
patches across the old and new shape. A half-migrated state — a current
`pnpm-workspace.yaml` sitting next to still-dead dependencies — leaves two
readers of the same repository reaching opposite conclusions from
adjacent files.

The commit must satisfy every item below; each traces to a specific audit
finding, not a preference:

1. Commit `dist/` and `.github/actions/local/`; add a CI workflow that
   runs test, lint, typecheck, and a rebuild-and-diff freshness gate.
2. Add a default schemastore step — a schema generator script over a
   small structured `result` output, a script that runs it, and the
   generator's own `targets` constant exercised by a drift test under
   `__test__/unit/` — per
   [B4](../conventions/github-action-canon.md#b4-json-schema-publication-is-conditional-canon).
3. Have `program.ts` emit the output baseline first, per
   [B10](../conventions/github-action-canon.md#b10-emit-the-output-baseline-first),
   and add the two-sided compile-time layers proof test, per
   [B11](../conventions/github-action-canon.md#b11-the-layers-proof-is-compile-time-and-two-sided).
4. Stop ignoring the plugin's skills and agents directories in
   `.gitignore`.
5. Add a "bootstrapping this template" section to the root `CLAUDE.md`
   pointing at the plugin's bootstrapping skill, naming the marketplace
   the plugin ships from and how to verify it loaded; register that
   marketplace in the devcontainer, and point the Claude launch script's
   plugin-directory flag at the plugin's own directory.
6. Correct stale versions in `CONTRIBUTING`, add the missing changeset
   script, fix the `README.md` placeholder, and correct any reference to
   a configuration file that does not exist.
7. Re-audit the shim register against the currently installed kit
   version.

Three properties of the regenerated template are canon, not incidental,
and must survive future regenerations too:

- **The runtime dependency set is exactly `@effected/github-actions`,
  `effect`, and `@effect/platform-node`.** Dependency honesty decides the
  list — there is no "common set" of additional kit packages to
  pre-declare; a package like `@effected/github` enters only as part of
  the edit that lands an optional module that actually imports it.
- **The skeleton is working, not empty.** Layer-less uniform-guard
  entries, a real `program.ts`, one demo step that exercises a skipped
  path, a `state.ts` round trip, `schema/inputs.ts` and `outputs.ts` with
  their three-way sync test, and a `format.ts` — each backed by real
  `it.effect` tests, plus the structural tests (dependency honesty,
  `@effect/vitest` actually imported, test placement).
- **The test command runs the suite with coverage and no
  pass-with-no-tests flag.** A template whose test command passes on an
  empty suite teaches its first reader that an empty suite is acceptable.

## End state

The template repository builds, lints, typechecks, and tests cleanly in
CI on a fresh clone; its `dist/` and `.github/actions/local/` are
committed and pass the freshness check; its own `CLAUDE.md` and docs make
no claim that does not hold against the actual tree; and the shim register
matches the currently installed kit version. A new action repository
scaffolded from it starts already conforming to
[the canonical action shape](../conventions/github-action-canon.md).
