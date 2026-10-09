---
type: Decision
title: Contract inversion is the default answer to a tier-dragging edge
description: When package A needs behaviour only package B can implement, A declares the narrow contract and B ships the layer implementing it, rather than A taking a direct dependency edge on B — the pattern now runs three times across the kit.
status: stable
tags:
  - architecture
sources:
  - id: npm-index
    resource: ../../packages/npm/src/index.ts
  - id: commands-local-exec
    resource: ../../packages/commands/src/LocalExec.ts
  - id: sbom-identity-token
    resource: ../../packages/sbom/src/IdentityToken.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 4a5c0ef34e155a7b54dfa9687645912d059b5754a5614ef3baae8356a423247d
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# Contract inversion is the default answer to a tier-dragging edge

## Context

A package sometimes needs behaviour that only a heavier, later-tiered
package can actually provide — dependency resolution against a real
workspace, a locally installed tool runner, a live OIDC token issuer. The
naive fix is a direct dependency edge from the package that needs the
behaviour to the package that can supply it. That edge tags along the
dependency policy's tier-propagation rule: any package depending on an
integrated-tier package becomes integrated itself, and every dependent of
*that* package inherits the same widening.

## Decision

The kit's standing default is **contract inversion**: the package that
needs the behaviour (`A`) declares a narrow contract describing exactly
what it needs, and the package that can actually implement it (`B`)
ships the layer satisfying that contract. `A` never takes a dependency
edge on `B`; `B` depends on `A` instead, to implement `A`'s interface.
This pattern now runs three times across the kit:

- `@effected/npm` declares the `CatalogResolver` and `WorkspaceResolver`
  contracts;[^npm-index] `@effected/workspaces` ships the layers
  implementing them, because catalog resolution needs
  `pnpm-workspace.yaml` plus the lockfile, and workspace-version
  resolution needs the discovered package list — both things only
  `workspaces` actually has.
- `@effected/commands` declares the `LocalExec` contract;[^commands-local-exec]
  `@effected/workspaces` ships that layer too, for the same reason: only
  `workspaces` knows how to resolve a locally installed tool inside a
  discovered monorepo.
- `@effected/sbom` declares the `IdentityToken` contract;[^sbom-identity-token]
  `@effected/github-actions` ships the layer that implements it against a
  live OIDC token issuer, because only the Actions runtime has a runner
  to ask.

## Alternatives rejected

- **A direct dependency edge from the needing package to the
  implementing package** (`npm` → `workspaces`, `commands` → `workspaces`,
  `sbom` → `github-actions`). Rejected in each case because it would
  propagate the implementing package's tier under the dependency policy's
  R2 rule — `workspaces` is integrated, so a direct edge from `commands`
  would have made `commands` integrated too, and would have dragged a
  pure package (`lockfiles`) and a boundary package (`package-json`)
  integrated behind it through their own edges into `commands`.
- **Merging the contract and the implementation into one package.**
  Rejected because the contract's natural home is beside the package that
  needs it and whose API surface it belongs to — a consumer wanting only
  `npm`'s dependency-resolution vocabulary should not have to take
  `workspaces`' entire discovery-and-graph engine to get it.

## Consequences

Contract inversion keeps the low-tier package's dependency surface
narrow — a pure or boundary package presents a clean interface without
importing the integrated package that eventually satisfies it — at the
cost of an extra indirection a reader has to trace: finding out that
`LocalExec` is actually implemented by `workspaces` means reading
`commands`' own documentation or module layout, not just its
`package.json`. Any future tier-dragging edge in the kit is expected to
resolve the same way: declare the contract at the lower tier, implement
it at the higher one, never invert that.

[^npm-index]: `packages/npm/src/index.ts:17-18,21,106` — `CatalogResolver`
    and `WorkspaceResolver` exported as contracts from `@effected/npm`,
    implemented elsewhere.
[^commands-local-exec]: `packages/commands/src/LocalExec.ts:13` — "the
    `@effected/workspaces` contributes, through `LocalExec`" — the
    contract `commands` declares and `workspaces` implements.
[^sbom-identity-token]: `packages/sbom/src/IdentityToken.ts:13-14` — "…
    implements it (`ActionsIdentityToken.layer`, over its
    `OidcTokenIssuer`), and a consumer already holding a token uses
    `IdentityToken.layerStatic`" — the contract `sbom` declares and
    `github-actions` implements.
