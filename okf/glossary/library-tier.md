---
type: Glossary
title: Library tier (pure / boundary / integrated)
description: The three-way classification of an @effected library by its own runtime dependency surface, distinct from what its consumers pull in.
status: stable
tags:
  - architecture
  - bundle
sources:
  - id: project
    resource: ../project.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 3d07c6956058e5cad4d074b2a903f7ab5e13754ecc721f9a47090822d8c27d3a
---

# Library tier (pure / boundary / integrated)

A library's **tier** in this repository classifies it by dependency
surface, answering the one question a consumer asks before taking an
edge on it: what does depending on this cost me? Tier is a property of a
package's own **runtime** surface — what it imports and whether it does
IO — never of who consumes it. devDependencies never count toward tier:
`@effect/vitest` and `@savvy-web/bundler` are test and build tooling,
irrelevant to the classification.

## The three tiers

- **Pure** — imports `effect` (as a peer) and `@effected/*` packages
  only. Performs no IO. Example: `semver`, `jsonc`, `yaml`.
- **Boundary** — the same dependency surface as pure, but performs IO
  through `effect` core's platform abstractions (`FileSystem`, `Path`,
  `PlatformError`). The consumer provides the platform layer at the edge.
  Example: `config-file`, `walker`, `xdg`.
- **Integrated** — imports at least one runtime package outside `effect`
  core. Effect-org packages (`@effect/sql-sqlite-node`,
  `@effect/platform-node`) count exactly the same as third-party ones
  (`ajv`, `@pnpm/catalogs.*`): the line is `effect` core versus
  everything else. Example: `store`, `workspaces`, `github`.

This repository does not mean "tier" in the sense of a general
architecture-diagram layer (frontend/backend/data) or a service-mesh
routing tier — here it names exactly one axis, external dependency
surface, and nothing else. A package that performs heavy IO but only
through `effect` core's contracts is boundary, not integrated; a package
that performs no IO at all but vendors a third-party engine is
integrated, not pure.

## The trap: a tier propagates through dependency edges

Depending on a tier-3 (integrated) `@effected` package makes the
dependent tier 3 too, whatever its own imports say, because that
package's external code lands in the consumer's tree transitively. A
package that itself imports nothing but `effect` and other `@effected/*`
packages can still be integrated if one of those `@effected/*` edges is
itself integrated — reading only the top-level `package.json` is not
enough; the classification has to walk the dependency graph.

The tier-2 (boundary) case runs the opposite way and is just as easy to
get backwards: a boundary package does **not** propagate its IO
requirement upward, because that IO is discharged by the app's own
platform layer, provided once at the edge. A consumer of a boundary
package pays no external install for it — `config-file` (boundary)
depends on `walker` (boundary) and stays boundary rather than being
pushed up a tier by that edge.

## How a package's tier is read

Every package's tier is recorded in the `Tier` column of the packages
table.[^project] The
companion package, `pnpm-plugin-effect`, carries no tier at all — see
[companion package](companion-package.md) for why tier does not apply to
it.

[^project]: `project.md` — the packages table's `Tier` column, for
    example the `config-file` row: "boundary | port of
    `config-file-effect`; the four config codecs as free-standing named
    exports."
