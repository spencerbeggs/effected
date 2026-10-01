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
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T03:17:21Z
  body_sha256: 8bc9a12196fee7b6d77b3aca04282e3e065ff6c0745523065b6b8037f015ea0a
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
  are optional peers, so a package manager installs them only when the
  consumer asks for them. A consumer who imports `./ui` and installs the
  peers takes an integrated edge; a consumer who does not pays nothing.[^cli-package-json]

R1 to R4 apply as follows. R1 is held by the root, which takes no external
runtime dependency. R2 propagates nothing, because nothing in the kit depends
on `@effected/cli`: only applications do. R4 holds, because the tier follows
the surface a consumer actually imports, not what the manifest permits.

## Alternatives rejected

- **Call the whole package integrated.** Rejected. It would tell every
  consumer of the root that it pays for an external install it never makes,
  and the tier label would stop carrying the dependency fact.
- **Split `./ui` into its own package to keep one tier per package.**
  Rejected in [the subpath decision](ui-is-a-subpath-with-optional-peers.md):
  the optional peers already cost a non-consumer nothing.

## Consequences

The project roster lists `@effected/cli` as boundary, with `./ui` noted as
integrated on opt-in. The layering check reads `peerDependencies`, but it
constrains `@effected/*` edges only, so the two new external peers do not
move `cli` in `layers.json`.

[^dependency-policy]: `../conventions/dependency-policy.md`
[^cli-package-json]: `../../packages/cli/package.json`
