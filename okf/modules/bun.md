---
type: Module
title: bun
description: Everything bun owns alone — its bun.lock document (BunLockDocument) and BunExtension — over the npm vocabulary it shares.
status: draft
kind: package
resource: ../../packages/bun
tags:
  - architecture
generated:
  by: "claude-code/sonnet-5.5"
  at: 2026-11-13T06:27:13Z
sources:
  - id: package-manager-model-design
    resource: ../../docs/superpowers/specs/2026-11-12-package-manager-model-design.md
  - id: bun-lock-document-ts
    resource: ../../packages/bun/src/BunLockDocument.ts
integrity:
  generated:
    body: c65080b276f5bc8c
---

# bun

## Purpose

`@effected/bun` holds every concept that is bun's alone.[^package-manager-model-design] The owner's rule is that a concept that is one manager's alone lives in that manager's package, and a concept shared by several managers lives in the lowest package they all depend on, which is [npm](npm.md). Today bun's alone is the `bun.lock` document and `BunExtension`.

## Tier and dependency posture

Pure tier at the root: `effect` and `@effected/semver` (closing `@effected/npm`'s peer) are the peers, `@effected/npm` and `@effected/jsonc` the dependencies, no IO. The dependency direction is `npm <- bun`, then `bun <- lockfiles <- workspaces`. No manager package depends on `lockfiles` or `workspaces`; `lockfiles` imports the native document schema and owns the normalisation into its common model. The package sits one layer above `npm` and below `lockfiles` in `lib/configs/layers.json`; [pnpm](pnpm.md) shares that layer.

## Contents

- **`BunLockDocument`**: `bun.lock` as bun writes it, JSONC: `lockfileVersion`, `workspaces` keyed by workspace path, `packages` as tuples of unknown values (their shape is under-documented upstream, so `lockfiles` reads each tuple's info object out of band), and the header `catalog`, `catalogs`, `overrides` and `trustedDependencies`. `BunLockDocument.parse` fails `@effected/npm`'s `LockfileDocumentError` with `reason: "syntax"` (with the JSONC engine's first diagnostic line) or `"shape"`; no `lockfileVersion` is rejected.[^bun-lock-document-ts]
- **`BunExtension`**: the header fields bun alone records, carried on `lockfiles`' `Lockfile.extension`. `BunLockDocument` reuses its field schemas, so the two cannot drift.

The binary `bun.lockb` is not read. There is no `bunfig.toml` settings catalog yet; that is later work in this package.

## Current state

The root entry exports `BunLockDocument` and `BunExtension`, pinned by `__test__/entrypoints.test.ts`. `__test__/BunLockDocument.test.ts` reads a copy of `lockfiles`' `bun/v2` fixture, with a provenance README beside it.

[^package-manager-model-design]: `docs/superpowers/specs/2026-11-12-package-manager-model-design.md`
[^bun-lock-document-ts]: `packages/bun/src/BunLockDocument.ts`
