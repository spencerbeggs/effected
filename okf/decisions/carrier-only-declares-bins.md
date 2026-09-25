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
generated:
  by: "okfit/claude-code"
  at: 2026-09-25T20:38:38Z
  body_sha256: 4f23cbf334b48bb3c1d5a321f1e856252fd550e73f2bf7d52c1d57290d02019d
verified:
  - by: human:spencer
    at: 2026-09-25T20:39:50Z
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
reads manifests the run already extracts, so it costs nothing extra, and it
is on by default with no opt-out, since a shared bin name makes the run's own
bin check able to pass on the wrong package.

## Alternatives rejected

- **Keep mirror bins and document the loss.** The finding offered this: say
  plainly that flat installs run the mirror and the carrier identity is lost
  there. Rejected because the identity is what the carrier exists to carry.
- **Make the check opt-in.** Rejected: the only consumer on `PackedInstall`
  had already accepted the rule, and an opt-in check protects nobody who does
  not know about the hazard.

## Consequences

A plugin loader's `npx` fallback can no longer name a front end, because
`npx <package>` runs that package's own bin. It names the carrier instead,
`npx --yes -p @scope/plugin@<MAJOR> <tool>-mcp`, which also carries the
distribution identity on the fallback path.[^vitest-agent-loader-status]

[^owner-ruling]: conversation with the repository owner, 2026-09-25.
[^vitest-agent-findings]: `.claude/dogfood/vitest-agent/2026-09-25-findings-front-end-kit.md`,
    Friction item 5.
[^vitest-agent-loader-status]: `.claude/dogfood/vitest-agent/2026-09-25-status-item15-loader.md`.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` — the
    `BinConflict` check in `run`.
[^carrier-entry-contract]: `plugins/claude-code/skills/design-patterns/references/carrier-entry-contract.md`
    — "Only the carrier declares a bin".
