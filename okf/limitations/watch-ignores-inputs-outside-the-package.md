---
type: Limitation
title: A watched build does not rebuild for inputs outside the package
description: "Under --watch, editing the root pnpm-workspace.yaml, the lockfile, or a tsconfig extends target outside the package triggers no rebuild, although a build reads them; restart the watch after such an edit."
status: draft
bounds: ../interfaces/build-commands.md
tags:
  - dx
sources:
  - id: build-watch
    resource: ../../packages/engine/src/build/BuildWatch.ts
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: "2026-11-18T00:00:00Z"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-18T18:13:08Z
integrity:
  generated:
    body: b1587117618e93e2
---

# A watched build does not rebuild for inputs outside the package

## Condition

`effected package build --watch` or `effected action build --watch` is running, and one of these files changes:

- the workspace root's `pnpm-workspace.yaml`, read for `catalog:` and `workspace:` resolution in the emitted manifest;
- the lockfile;
- a tsconfig that the package's tsconfig `extends` from outside the package.

## Symptom

Nothing rebuilds. The next build, triggered by an edit inside the package or by a restart, reads the new content. Until then `dist` reflects the old one.

## Why it is acceptable

The watch covers the package directory and the root `effected.toml` tiers, and nothing else outside the package.[^build-watch] These inputs change rarely, and usually together with an install, which restarts the watch anyway. Watching them would make one catalog bump rebuild every watched package in the workspace.[^owner-ruling] A change in a sibling workspace package's source does not rebuild its dependents either: following the dependency graph is turbo's job.

## Workaround

Restart the watch after editing one of these files, or save any file inside the package to trigger a full rebuild.

[^build-watch]: `packages/engine/src/build/BuildWatch.ts`: the watch set.
[^owner-ruling]: The repository owner's decision on the build-watch design, 2026-11-18.
