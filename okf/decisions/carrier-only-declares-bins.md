---
type: Decision
title: Only the carrier declares a bin
description: In the carrier pattern, front ends declare no bin of the carrier's names, so the carrier identity survives every package manager's layout; PackedInstall enforces it as BinConflict.
status: stable
tags:
  - architecture
  - dx
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-25T00:00:00Z
  - id: vitest-agent-findings
    resource: ../../.claude/dogfood/vitest-agent/2026-09-25-findings-front-end-kit.md
  - id: vitest-agent-loader-status
    resource: ../../.claude/dogfood/vitest-agent/2026-09-25-status-item15-loader.md
  - id: packed-install-ts
    resource: ../../packages/workspaces/src/PackedInstall.ts
  - id: carrier-entry-contract
    resource: ../../plugins/claude-code/skills/design-patterns/references/carrier-entry-contract.md
  - id: review-ruling
    resource: conversation with the repository owner, ruling on the review of the PackedInstall round-2 change
    author: human:spencer
    last_modified: 2026-09-25T00:00:00Z
  - id: okfit-consumer
    resource: ../consumers/okfit.md
  - id: systems-consumer
    resource: ../consumers/systems.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-25T20:48:19Z
  body_sha256: 39402704ce40d2478bb7833525757a89c18ec6380c0d9b20d6fac07bba4f0c75
verified:
  - by: human:spencer
    at: 2026-09-25T20:39:50Z
  - by: human:spencer
    at: 2026-09-25T20:47:50Z
---

# Only the carrier declares a bin

## Context

The carrier pattern ships one bin shim per front end in the carrier, each
calling the front end's `main()` with the carrier's distribution identity.
Front ends used to declare the same bin names themselves ("mirror bins").
vitest-agent's packed-install e2e asserted which package each `.bin` entry
belonged to, and found npm and bun linking the front end's mirror bin over
the carrier's shim, so `--version` lost its `via @vitest-agent/plugin`
suffix; only pnpm's isolated layout kept the carrier's shim.[^vitest-agent-findings]
The tool still ran, but the carrier identity depended on the package manager.

## Decision

Only the carrier declares a bin. Front ends declare none with a name the
carrier declares; the teaching is that they declare no `bin` at all and
keep `src/bin.ts` as a workspace-local development entry.[^owner-ruling]
The rule is taught in the design-patterns skill's entry contract.[^carrier-entry-contract]

`PackedInstall.run` enforces it: a packed package other than the carrier
(a closure member or an override) that declares one of the carrier's bin
names fails `BinConflict` before any install.[^packed-install-ts] The check
reads manifests the run already extracts, so it costs nothing extra. It is
on by default, because a shared bin name lets the run's own bin check pass
on the wrong package. It compares packed packages' `bin` fields only:
`directories.bin` is not read, and a registry dependency declaring the same
name goes undetected.

`allowSharedBins: true` opts a run out of the check.[^review-ruling] It
exists for tools mid-migration away from mirror bins, whose front ends
still declare the carrier's names and would otherwise fail every packed
install until the migration ships. The run still verifies the expected
bins are present, but with the front ends sharing the names a flat layout
can link a front end's bin, so a test using the opt-out asserts
`binProvenance` until the migration lands.

## Alternatives rejected

- **Keep mirror bins and document the loss.** The finding offered this: say
  plainly that flat installs run the mirror and the carrier identity is lost
  there. Rejected because the identity is what the carrier exists to carry.
- **Make the check opt-in.** Rejected: an opt-in check protects nobody who
  does not know about the hazard. The strict default with an explicit
  opt-out keeps the hazard visible in every test that still has it.

## Consequences

A plugin loader's `npx` fallback can no longer name a front end, because
`npx <package>` runs that package's own bin. It names the carrier instead,
`npx --yes -p @scope/plugin@<MAJOR> <tool>-mcp`, which also carries the
distribution identity on the fallback path.[^vitest-agent-loader-status]

Dropping a front end's `bin` breaks anyone who installed that front end, or
ran it through `npx`, for its bin. Each migration is therefore a major bump
of every front end that loses a bin, with the plugin loader moving to the
`npx --yes -p <carrier>@<MAJOR> <bin>` form in the same release, so the
fallback never names a package that no longer has a bin.

Pending migrations: okfit, whose `@okfit/cli`, `@okfit/lsp` and
`@okfit/mcp` mirror `@okfit/plugin`'s `okfit`, `okfit-lsp` and `okfit-mcp`,
and whose loaders (and their `loader.bats`/`lsp-loader.bats` pins) fall back
to `npx --yes @okfit/mcp` and `npx --yes @okfit/lsp`;[^okfit-consumer] and
systems, whose `@savvy-web/cli` and `@savvy-web/mcp` mirror
`@savvy-web/silk`'s `savvy` and `savvy-mcp`, with its loader falling back to
`npx --yes @savvy-web/mcp`.[^systems-consumer] vitest-agent is migrating in
its front-end-kit dogfood round.

[^owner-ruling]: conversation with the repository owner, 2026-09-25.
[^vitest-agent-findings]: `.claude/dogfood/vitest-agent/2026-09-25-findings-front-end-kit.md`,
    Friction item 5.
[^vitest-agent-loader-status]: `.claude/dogfood/vitest-agent/2026-09-25-status-item15-loader.md`.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` — the
    `BinConflict` check in `run`.
[^carrier-entry-contract]: `plugins/claude-code/skills/design-patterns/references/carrier-entry-contract.md`
    — "Only the carrier declares a bin".
[^review-ruling]: conversation with the repository owner, 2026-09-25,
    ruling on the review of the round-2 `PackedInstall` change.
[^okfit-consumer]: [okfit consumer](../consumers/okfit.md) — surveyed
    2026-09-25 from its `packages/*/package.json` and
    `plugins/claude-code/bin/start-{mcp,lsp}.sh`.
[^systems-consumer]: [systems consumer](../consumers/systems.md) — surveyed
    2026-09-25 from its `packages/*/package.json` and
    `plugins/silk/bin/start-mcp.sh`.
