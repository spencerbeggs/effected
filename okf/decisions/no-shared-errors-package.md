---
type: Decision
title: "Decided against: a shared @effected/errors package"
description: A cross-package errors package was rejected for four reasons — the kit already has a shared error vocabulary in effect core, a central errors package inverts ownership and couples every error change to a cross-package release, Effect's error channel already composes unions structurally, and the genuine cross-boundary case already has a house pattern.
status: stable
tags:
  - architecture
sources:
  - id: root-claude-conventions
    resource: ../../CLAUDE.md
  - id: npm-catalog-assembly-error
    resource: ../../packages/npm/src/CatalogAssemblyError.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 269716f90fdc58fa
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 114128fb133d0812
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Decided against: a shared @effected/errors package

## Context

Several kit packages define tagged errors that other packages need to
catch or compose against. A recurring proposal was a shared
`@effected/errors` package: one place to define common error shapes so
packages did not each reinvent conventions like a `_tag` field or a
`reason` union.

## Decision

The kit decided against a shared `@effected/errors` package, for four
reasons:

1. **The kit already has a shared error vocabulary.** Effect core's
   `PlatformError`, `SqlError` and Schema parse issues are the errors
   that genuinely cross every package boundary already, and they live in
   `effect` rather than in a kit-authored package.
2. **A central errors package is a barrel with different syntax**, and it
   inverts ownership: each package's error model is part of its designed
   API surface, and centralizing that model would make every error
   change a cross-package release event rather than a change contained
   to the package that owns the behaviour producing the error.
3. **Effect's error channel already composes unions structurally.**
   Tagged errors discriminate on `_tag`, `catchTag` narrows on it, and an
   effect typed `Effect<A, WalkerError | ConfigParseError>` flows across
   package boundaries with no nominal coordination required — nothing a
   shared errors package would add composes any better.
4. **The genuine cross-boundary case already has a house pattern.**
   `@effected/npm` is the worked example: when an error must cross a
   package boundary, it travels with the contract it belongs to, into a
   small package named for that contract, rather than into a generic
   errors package. `CatalogAssemblyError` lives beside the
   `CatalogResolver` contract that raises it, for the same reason
   `DependencyResolutionError` lives beside
   `WorkspaceResolver`.[^npm-catalog-assembly-error]

## Alternatives rejected

- **A shared `@effected/errors` package** carrying common tagged-error
  base shapes or a `reason`-union convention every package's errors
  would extend. Rejected for the four reasons above.
- **A convention document with no package at all**, leaving each
  package's error shape entirely independent with no shared reference.
  Rejected in favor of still legislating error-shape conventions — `_tag`
  naming, structure-preserving fields, per-reason tagged unions rather
  than one class carrying a `reason` field — as a repository
  convention,[^root-claude-conventions] just not as a runtime package.

## Consequences

An error that needs to travel between two packages gets its own small,
purpose-named package beside the contract it serves, following the
`@effected/npm` pattern, rather than a dependency on a shared errors
package. Error-shape conventions (tag naming, field structure) are
enforced as house style rather than by importing a common base class, so
a package's error types remain fully part of that package's own API
surface and versioning.

[^root-claude-conventions]: `CLAUDE.md` — the commit/testing conventions
    this decision sits alongside; the kit legislates error *shape* as
    convention rather than as a shared runtime dependency.
[^npm-catalog-assembly-error]: `packages/npm/src/CatalogAssemblyError.ts:3-7,27`
    — "so the `CatalogResolver` contract can name it in its error
    channel… It lives in its own module… for the same reason
    `DependencyResolutionError` lives in `WorkspaceResolver.ts`."
