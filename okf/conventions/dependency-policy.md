---
type: Convention
title: "Dependency policy: R1-R4"
description: The four rules governing how a library's tier and its dependencies relate, including when a retier to integrated is admissible.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - bundle
sources:
  - id: schemastore-build
    resource: ../../packages/schemastore/savvy.build.ts
  - id: config-file-package-json
    resource: ../../packages/config-file/package.json
  - id: lockfiles-src
    resource: ../../packages/lockfiles/src
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 979ee0205669c359407e14288098131a58b00b164068e852d5d317444978ed57
---

# Dependency policy: R1-R4

Four rules govern how a library's [tier](../glossary/library-tier.md) and
its dependencies relate. The framing default is to stay as Effect-native
as possible — a program built only from Effect primitives composes and
typechecks as one thing — but that default is tier-scoped, not global.

## R1 — tiers 1 and 2 take no external runtime dependencies

> Pure and boundary packages peer-depend on `effect` and may take
> `@effected/*` edges (`workspace:^`, regardless of whether the edge is a
> peer or a regular dependency), nothing else. Moving a package to tier 3
> (integrated) is a decision recorded in that package's design doc, never
> a default.

`@effected/schemastore` is the one package in the kit retiered after
publishing[^schemastore-build] — boundary to integrated on 2026-08-04,
to take `ajv` directly for build-time schema validation. What made the
retier admissible: nothing in the kit depends on `schemastore`, so R2
propagates the tier to nobody, and `ajv` is build-time tooling a
consumer installs as a devDependency, so the runtime-graph weight R1
guards against was never on anyone's bill. The second fact stopped
holding once applications imported the library at runtime for
`HostedSchema`, and on 2026-09-15 the engine moved to the
`schemastore-cli` companion and the package returned to boundary
([the engine lives in the CLI](../decisions/schemastore-engine-lives-in-the-cli.md)).
A retier candidate should be checked against those same two facts
before being accepted — and re-checked when a consumer's use changes.

R1 does not mean "parsing has no IO, so a format package is pure, so it
may not take a runtime dependency." Tier 3 is defined by dependencies
alone, so a package that does no IO can still legally be tier 3.
`@effected/toml` and `@effected/glob` vendor their engines into
`src/internal/` because of R1, not because they happen to lack IO — the
vendoring *is* the wrapper that keeps the package at tier 1, hardened per
the [input-hardening standards](input-hardening-standards.md). The rule
only bites where the third-party code is large, encumbered or itself
dependency-laden; in that case a tier-1/2 shape was wrong to begin with.

## R2 — tier 3 propagates

> Depending on a tier-3 `@effected` package makes you tier 3, whatever
> your own imports say, because that package's external code lands in
> your consumer's tree transitively.

See the [tier taxonomy](../glossary/library-tier.md) for the trap this
creates: a package's own `package.json` is not enough to determine its
tier, because the classification has to walk the `@effected/*`
dependency graph.

## R3 — tier 2 does not propagate

> A boundary package's IO is discharged by the app's platform layer,
> provided once at the edge, so a consumer of a tier-2 package pays no
> external install for it.

`@effected/config-file` (boundary) depends on `@effected/walker`
(boundary) and stays boundary rather than being pushed up a tier by that
edge — its `package.json` declares no external runtime
dependency.[^config-file-package-json] R3 is what justifies R4's claim
that tier follows a package's own surface rather than its dependents'.

## R4 — tier follows a package's own surface, never its consumers'

> Tier follows a package's own surface (plus R2 for propagation), never
> its consumers'.

A package that wraps `parse`/`stringify` and never touches `FileSystem`
is pure even when its only consumer is a boundary library.
`@effected/lockfiles` is pure for exactly this reason: every entrypoint
takes `content: string`, and the file reading lives in
`@effected/workspaces` instead.[^lockfiles-src] Conversely, a package
becomes boundary the moment it performs IO itself, however thin.

R3 and R4 together are what keep `@effected/config-file` at boundary even
though it absorbs the four config codecs and peers on the pure `jsonc`,
`yaml` and `toml` format packages: `@effected/*` edges do not propagate
tier by themselves, only tier-3 does under R2.

## What the scheme buys

The tier label carries the dependency fact directly: "boundary" on
`@effected/config-file` says it carries zero external runtime
dependencies, which is what distinguishes it from integrated
`@effected/workspaces` without a sentence of prose. It also drives split
decisions — a package whose platform-specific half is tier 3 and whose
core logic is tier 2 should be split so the tier-2 half's consumers do
not pay for a tier-3 install they never asked for.

[^schemastore-build]: `packages/schemastore/savvy.build.ts` — the build
    configuration for the one package retiered after publishing, first
    to integrated and then back to boundary.
[^config-file-package-json]: `packages/config-file/package.json` —
    declares no runtime dependency outside `effect` and `@effected/*`
    peers.
[^lockfiles-src]: `packages/lockfiles/src/` — every parse entrypoint
    takes `content: string` rather than a path, keeping the package pure.
