---
type: Decision
title: Carrier-only bins are recommended; shared bins are a supported choice
description: "In the carrier pattern, front ends should declare no bin of the carrier's names, required only when provenance must hold under flat installs; sharing the names is a supported choice with allowSharedBins, and PackedInstall's BinConflict default makes it explicit."
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
  - id: okfit-consumer
    resource: ../consumers/okfit.md
  - id: systems-consumer
    resource: ../consumers/systems.md
  - id: vitest-agent-optout-status
    resource: ../../.claude/dogfood/vitest-agent/2026-09-25-status-item15-optout.md
  - id: vitest-agent-round2-findings
    resource: ../../.claude/dogfood/vitest-agent/2026-09-25-findings-round2-front-end-kit.md
  - id: reframe-ruling
    resource: conversation with the repository owner, ruling on vitest-agent's round-2 friction items 18 to 20
    author: human:spencer
    last_modified: 2026-09-25T00:00:00Z
  - id: packed-install-e2e
    resource: ../../packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-25T21:24:18Z
  body_sha256: 40a373a0829945fb786a51006eb33248527943916d949140962196079d621aac
verified:
  - by: human:spencer
    at: 2026-09-25T20:39:50Z
  - by: human:spencer
    at: 2026-09-25T20:47:50Z
  - by: human:spencer
    at: 2026-09-25T21:18:59Z
  - by: human:spencer
    at: 2026-09-25T21:26:12Z
---

# Carrier-only bins are recommended; shared bins are a supported choice

## Context

The carrier pattern ships one bin shim per front end in the carrier, each
calling the front end's `main()` with the carrier's distribution identity.
Front ends may also declare the same bin names themselves ("mirror" or
shared bins). vitest-agent's packed-install e2e asserted which package each
`.bin` entry belonged to, and found npm and bun linking the front end's bin
over the carrier's shim, so `--version` lost its `via @vitest-agent/plugin`
suffix; only pnpm's isolated layout kept the carrier's shim.[^vitest-agent-findings]
The kit's own e2e narrowed the cause: npm 11 and bun 1.4 link the package
whose name sorts first, so a `cli` front end beats a `plugin` carrier, and
the same pair named the other way round let the carrier win; Yarn 1.22 and
4.18 kept the carrier's bin, the consumer's direct dependency.[^packed-install-e2e]
The tool runs either way; what depends on the package manager is the carrier
identity.

The first ruling made carrier-only bins the rule.[^owner-ruling] vitest-agent
then kept its front-end bins deliberately. Its front ends are useful on
their own; shadowing under npm and bun changes nothing but provenance,
because every bin calls the same `main()`; and dropping the bins would break
direct use of `@vitest-agent/cli` and `@vitest-agent/mcp`, force a major on
both, and make the loader's `npx` fallback download the whole carrier.[^vitest-agent-optout-status]

## Decision

Carrier-only bins are **recommended**: front ends declare no bin with a name
the carrier declares, keeping `src/bin.ts` as a workspace-local development
entry. They are **required** only when provenance (the `--version` suffix,
the distribution identity) must hold under flat installs.[^reframe-ruling]
The design-patterns skill teaches both shapes.[^carrier-entry-contract]

Shared bins are a **supported, permanent alternative** for a carrier whose
front ends also stand alone. Its cost, stated plainly: under npm and bun
(and possibly Yarn, though Yarn 1 and 4 were observed keeping the carrier's)
a front end's bin can win the `.bin` slot, and then provenance is lost;
behaviour is otherwise the same when every bin calls the same `main()`.

`PackedInstall.run` makes the choice explicit. Its `BinConflict` check stays
on by default: a packed package other than the carrier (a closure member or
an override) that declares one of the carrier's bin names fails before any
install.[^packed-install-ts] It reads manifests the run already extracts, and
compares packed packages' `bin` fields only: `directories.bin` is not read,
and a registry dependency declaring the same name goes undetected.
`allowSharedBins: true` is how a carrier that shares its bin names says so.
The run still verifies the expected bins are present, and
`InstalledConsumer.runCarrierBin` proves the carrier's own shim through its
installed `bin` map whichever package took the slot, recovering the
coverage a shared name would otherwise leave to pnpm alone.[^vitest-agent-round2-findings]

## Alternatives rejected

- **Carrier-only bins as a hard rule.** Rejected on vitest-agent's reasons:
  it would force a major on every standalone front end for a gain in
  provenance only, which a carrier may reasonably not need.
- **Keep mirror bins silently.** Rejected: which package runs would still
  depend on the package manager, unseen. The default-on `BinConflict` plus
  an explicit `allowSharedBins` keeps the trade-off visible in every test
  that makes it.
- **Make the check opt-in.** Rejected: an opt-in check protects nobody who
  does not know about the hazard.

## Consequences

For carriers that drop their front-end bins, a plugin loader's `npx`
fallback can no longer name a front end, because `npx <package>` runs that
package's own bin. It names the carrier instead,
`npx --yes -p @scope/plugin@<MAJOR> <tool>-mcp`, which also carries the
distribution identity on the fallback path.[^vitest-agent-loader-status]
Dropping a front end's `bin` breaks anyone who installed that front end, or
ran it through `npx`, for its bin, so that move is a major bump of every
front end that loses a bin, with the loader moving to the carrier form in
the same release. A carrier that keeps shared bins keeps its front-end
fallback.

Optional migrations, not pending ones: okfit, whose `@okfit/cli`,
`@okfit/lsp` and `@okfit/mcp` share `@okfit/plugin`'s `okfit`, `okfit-lsp`
and `okfit-mcp`, with loaders (and their `loader.bats`/`lsp-loader.bats`
pins) falling back to `npx --yes @okfit/mcp` and `@okfit/lsp`;[^okfit-consumer]
and systems, whose `@savvy-web/cli` and `@savvy-web/mcp` share
`@savvy-web/silk`'s `savvy` and `savvy-mcp`, with its loader falling back to
`npx --yes @savvy-web/mcp`.[^systems-consumer] Either may keep shared bins
with `allowSharedBins`, or migrate if its identity must hold under flat
installs. vitest-agent keeps shared bins.

[^owner-ruling]: conversation with the repository owner, 2026-09-25.
[^vitest-agent-findings]: `.claude/dogfood/vitest-agent/2026-09-25-findings-front-end-kit.md`,
    Friction item 5.
[^vitest-agent-loader-status]: `.claude/dogfood/vitest-agent/2026-09-25-status-item15-loader.md`.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` — the
    `BinConflict` check in `run`, `allowSharedBins`, and
    `InstalledConsumer.runCarrierBin`.
[^carrier-entry-contract]: `plugins/claude-code/skills/design-patterns/references/carrier-entry-contract.md`
    — "Who declares a bin".
[^okfit-consumer]: [okfit consumer](../consumers/okfit.md) — surveyed
    2026-09-25 from its `packages/*/package.json` and
    `plugins/claude-code/bin/start-{mcp,lsp}.sh`.
[^systems-consumer]: [systems consumer](../consumers/systems.md) — surveyed
    2026-09-25 from its `packages/*/package.json` and
    `plugins/silk/bin/start-mcp.sh`.
[^vitest-agent-optout-status]: `.claude/dogfood/vitest-agent/2026-09-25-status-item15-optout.md`
    — its owner's reasons for keeping the front-end bins.
[^vitest-agent-round2-findings]: `.claude/dogfood/vitest-agent/2026-09-25-findings-round2-front-end-kit.md`,
    Friction items 2 and 3.
[^reframe-ruling]: conversation with the repository owner, 2026-09-25,
    ruling on vitest-agent's round-2 friction items 18 to 20.
[^packed-install-e2e]: `packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts`
    — the shared-bin case, and the name-order observation behind it.
