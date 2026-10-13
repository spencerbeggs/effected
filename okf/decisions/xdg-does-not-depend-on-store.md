---
type: Decision
title: xdg does not depend on store
description: XDG resolution stays boundary tier by never taking a workspace edge on the integrated-tier store package -- the SQLite database services were split out precisely to keep this split possible.
status: draft
tags:
  - architecture
sources:
  - id: xdg-claude-md
    resource: ../../packages/xdg/CLAUDE.md
  - id: store-claude-md
    resource: ../../packages/store/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 2f3ad05f60ac7fd5
---

# xdg does not depend on store

## Context

An earlier, unpublished design combined XDG resolution and SQLite-backed
persistence in one package. Splitting them raised the question of
whether the XDG half should still depend on the persistence half to wire
a database path automatically.

## Decision

`@effected/xdg` carries **no dependency on `@effected/store`**, and none
is ever added. Store is [integrated tier](../glossary/library-tier.md)
through its one `@effect/sql-sqlite-node` runtime dependency (see
[store is v4 SQLite](store-v4-sqlite.md)); depending on it would
propagate that tier onto xdg under [the dependency
policy](../conventions/dependency-policy.md)'s R2, and drag the SQLite
driver into every consumer that only wants directory resolution. Keeping
that edge out is the entire reason xdg stays boundary tier. Every xdg
layer instead takes a plain `filename` string or an abstract `SqlClient`
— it has no idea a database exists.

The glue that wires an `AppDirs`-resolved path into a `Store` or `Cache`
layer belongs one level up, in [app](../modules/app.md), which is the
only package with peers on both xdg and store simultaneously.

This same boundary-tier motivation is why xdg also carries no runtime
dependency of its own and does its IO exclusively through `effect`
core's `FileSystem`/`Path` — a JSON-schema or format-parsing dependency
was considered and cut for the same reason during the split from the
combined predecessor design, since either would have pulled a runtime
engine into a package whose entire job is turning environment variables
into path strings.

## Alternatives rejected

- **xdg depends on store and wires the database path itself.**
  Rejected: it would make every xdg consumer tier 3 by propagation, even
  one that never touches a database, and would duplicate the
  ensure-before-open composition that only makes sense once both
  services are already in scope — see
  [app's ensure-before-open contract](../modules/app.md#the-ensure-before-open-contract).
- **A shared "xdg-plus-store" package**, the shape of the predecessor
  design. Rejected: it forced every consumer of directory resolution to
  also accept the SQLite dependency, which is the exact coupling the
  split exists to remove.

## Consequences

A future runtime dependency proposed for xdg — a format parser, a
JSON-schema validator, anything beyond `effect` core's platform
abstractions — should be read as a retier proposal and evaluated with
the same scrutiny as a direct dependency on store would receive.
