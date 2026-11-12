---
type: Module
title: bun
description: Everything bun owns alone — its lockfile document grammar and BunExtension — over the npm vocabulary it shares.
status: draft
kind: package
resource: ../../packages/bun
tags:
  - architecture
generated:
  by: "claude-code/sonnet-5.5"
  at: 2026-11-12T23:05:46Z
sources:
  - id: package-manager-model-design
    resource: ../../docs/superpowers/specs/2026-11-12-package-manager-model-design.md
integrity:
  generated:
    body: 2366a72045fa7de5
---

# bun

## Purpose

`@effected/bun` holds every concept that is bun's alone.[^package-manager-model-design] The owner's rule is that a concept that is one manager's alone lives in that manager's package, and a concept shared by several managers lives in the lowest package they all depend on, which is [npm](npm.md). Today bun's alone is the `bun.lock` and `bun.lockb` document grammar and `BunExtension`.

## Tier and dependency posture

Pure tier at the root: `effect` is the only peer, `@effected/npm` the only dependency, no IO. The dependency direction is `npm <- bun`, then `bun <- lockfiles <- workspaces`. No manager package depends on `lockfiles` or `workspaces`; `lockfiles` imports the native document schema and owns the normalisation into its common model. The package sits one layer above `npm` and below `lockfiles` in `lib/configs/layers.json`; [pnpm](pnpm.md) shares that layer.

## Contents

The package owns bun's lockfile document and `BunExtension`. There is no `bunfig.toml` settings catalog yet; that is later work in this package.

## Current state

The package is scaffolded: the root entry is empty and the lockfile document moves in from `lockfiles`.

[^package-manager-model-design]: `docs/superpowers/specs/2026-11-12-package-manager-model-design.md`
