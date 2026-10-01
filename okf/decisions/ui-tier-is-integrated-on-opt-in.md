---
type: Decision
title: The cli root stays boundary, and ./ui is integrated only for consumers who opt in
description: "@effected/cli keeps a boundary-tier root while its ./ui subpath imports the third-party ink and react, which makes ./ui integrated only for a consumer who installs those optional peers; R1-R4 are read per entrypoint for this package."
status: draft
tags: [architecture, deps, bundle]
sources:
  - id: dependency-policy
    resource: ../conventions/dependency-policy.md
    title: "Dependency policy: R1-R4"
  - id: cli-package-json
    resource: ../../packages/cli/package.json
    title: The cli manifest
  - id: schemastore-cli-package-json
    resource: ../../packages/schemastore-cli/package.json
    title: The schemastore-cli manifest, the one kit package that depends on cli
  - id: npm-optional-peers
    resource: https://docs.npmjs.com/cli/v11/configuring-npm/package-json#peerdependenciesmeta
    title: "npm package.json docs, peerDependenciesMeta"
  - id: pnpm-auto-install-peers
    resource: https://pnpm.io/settings/peer-dependencies#autoinstallpeers
    title: "pnpm settings, autoInstallPeers"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T03:23:20Z
  body_sha256: 5951dba03d70fc3c782c2a7c72cacf5d9aacc2496fdbe9d9f50124912f8382b5
---

# The cli root stays boundary, and ./ui is integrated only for consumers who opt in

## Context

A [library's tier](../glossary/library-tier.md) is its own runtime
dependency surface. `@effected/cli`'s root is boundary: it imports `effect`
and `@effected/*` packages only, and does its IO through core's services.
The [./ui subpath](ui-is-a-subpath-with-optional-peers.md) imports `ink` and
`react`, which are third-party runtime packages, so by the tier definition
anything that loads `./ui` is integrated. R1 forbids an external runtime
dependency on a boundary package unless a retier is recorded.[^dependency-policy]

## Decision

The tier is read per entrypoint for this package, and this is the first
package in the kit to need that reading:

- **The root and `./testing` stay boundary.** They reach neither `ink` nor
  `react`, which the boundary test proves by walking the module graph.
- **`./ui` and `./ui/testing` are integrated, on opt-in.** `ink` and `react`
  are optional peers.[^cli-package-json] npm states that it "will not
  automatically install optional peer dependencies",[^npm-optional-peers]
  and pnpm's `autoInstallPeers` installs only missing **non-optional**
  peers.[^pnpm-auto-install-peers] So a consumer who imports `./ui` and
  installs the peers takes an integrated edge, and a consumer who does not
  installs nothing for it.

R1 to R4 apply as follows:

- **R1** is held by the root and `./testing`, which take no external runtime
  dependency. Only the opt-in subpaths name one.
- **R2** propagates tier only from a tier-3 package. The one kit package that
  depends on `@effected/cli` is `schemastore-cli`,[^schemastore-cli-package-json]
  a [companion](../glossary/companion-package.md) that carries no tier and
  imports only the boundary root, so nothing inherits a tier from `./ui`.
- **R3** keeps the root boundary despite its `@effected/*` edges (`env`,
  `walker`, `glob`, `config-file`, `github-commands`): each is boundary or
  pure, and a boundary edge does not propagate.
- **R4** holds, because the tier follows the surface a consumer actually
  imports, not what the manifest permits.

## Alternatives rejected

- **Call the whole package integrated.** Rejected. It would tell every
  consumer of the root that it pays for an external install it never makes,
  and the tier label would stop carrying the dependency fact.
- **Split `./ui` into its own package to keep one tier per package.**
  Rejected in [the subpath decision](ui-is-a-subpath-with-optional-peers.md):
  the optional peers already cost a non-consumer nothing.

## Consequences

- The project roster keeps `cli` at boundary. The per-entrypoint reading lives
  here and in the [cli Module](../modules/cli.md).
- The layering check reads `peerDependencies`, but it constrains `@effected/*`
  edges only, so the two new external peers do not move `cli` in
  `layers.json`.
- **"Installs nothing" holds only while no incompatible `react` is in the
  tree. This is not probed.** npm's resolver treats a present but out-of-range
  optional peer as a conflict, so a consumer tree that already holds, say,
  `react@18` may fail `npm install` with `ERESOLVE` even though it never
  imports `./ui`.

[^dependency-policy]: `../conventions/dependency-policy.md`
[^cli-package-json]: `../../packages/cli/package.json`
[^npm-optional-peers]: <https://docs.npmjs.com/cli/v11/configuring-npm/package-json#peerdependenciesmeta>
[^pnpm-auto-install-peers]: <https://pnpm.io/settings/peer-dependencies#autoinstallpeers>
[^schemastore-cli-package-json]: `../../packages/schemastore-cli/package.json`
