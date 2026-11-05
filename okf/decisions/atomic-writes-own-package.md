---
type: Decision
title: Atomic writes live in their own package, @effected/files, not in @effected/kit or @effected/store
description: "The atomic single-file write and the whole-directory replacement are one boundary-tier package, @effected/files; AtomicDirectory moved out of @effected/store with no shim, and @effected/kit was rejected as the home because it is a pure, platform-free carrier primitive set while these need FileSystem and Path in R."
status: stable
tags:
  - architecture
  - bundle
sources:
  - id: files-module
    resource: ../modules/files.md
  - id: kit-module
    resource: ../modules/kit.md
  - id: store-module
    resource: ../modules/store.md
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T17:20:54Z
integrity:
  generated:
    body: 4ec7add7f7e0c94e
  verified:
    by: human:spencer
    at: 2026-11-05T17:32:05Z
    content: 57ad9a37168e5fe6
verified:
  - by: human:spencer
    at: 2026-11-05T17:32:05Z
---

# Atomic writes live in their own package, @effected/files, not in @effected/kit or @effected/store

## Context

Several packages write user files (`package-json`, `config-file`, `templates`, the schema output) and each needs the same crash-safe replacement. `AtomicDirectory` already existed, but inside `@effected/store`, an integrated-tier package.[^store-module] One shared implementation needed a home that every writer could depend on.

## Decision

Create `@effected/files`, a boundary-tier package that owns `AtomicFile.write` and `AtomicDirectory` with its error, over core `FileSystem` and `Path` in `R`.[^files-module] Move `AtomicDirectory`, `AtomicDirectoryError` and `AtomicDirectoryFiles` out of `@effected/store` with no re-export, so a stale import fails at build. Writers take it as a regular `workspace:^` dependency, because it carries no shared-instance contract.

## Alternatives rejected

- **`@effected/kit`.** It is a pure, platform-free set of primitives shared by a carrier tool's front ends.[^kit-module] Atomic writes do IO through `FileSystem` and `Path`, so putting them there would change its tier and make every format and config package depend on a carrier library.
- **Leave `AtomicDirectory` in `@effected/store`.** A package that only needs a safe write would depend on an integrated-tier store, and `AtomicFile` has no natural place there.
- **A re-export shim in `store`.** Rejected under the kit's rename posture: a stale import fails at build rather than silently keeping two homes.

## Consequences

The consumer-facing move is recorded in the upgrade ledger. The package has `effect` as its only peer and no `@effected/*` dependency, so any writer can adopt it without a dependency cycle.

[^files-module]: `../modules/files.md`
[^kit-module]: `../modules/kit.md`
[^store-module]: `../modules/store.md`
