---
type: Convention
title: Support the current major and one back of every package manager
description: The kit provisions and models the current major and one major back of every package manager — pnpm 11 + 12 and npm 11 + 12 as of 2026-09-17 — detecting an artifact layout by what the manifest declares, never by major; older majors get no code paths, tests, fixtures or docs.
status: stable
stale_after: 2027-03-17T00:00:00Z
tags:
  - compat
  - deps
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-17T00:00:00Z
  - id: installer
    resource: ../../packages/github-actions/src/PackageManagerInstaller.ts
  - id: pnpm-exe
    resource: ../../packages/github-actions/src/internal/pnpmExe.ts
  - id: npm-12
    resource: npm:npm@12.0.2
generated:
  by: "okfit/claude-code"
  at: 2026-09-17T21:24:06Z
  body_sha256: 3be49cb1a6f5cbb16186dd6f4a191e8d9810d1e9f1a5201479da803d88884858
---

# Support the current major and one back of every package manager

Support **the current major and one major back** of every package manager
the kit provisions or models, and nothing older.[^owner] As of 2026-09-17
that window is pnpm 11 and 12 and npm 11 and 12; yarn and bun follow the
same rule. An older major is not a compatibility target: do not add a code
path, a test, a fixture or a paragraph of documentation for it, and remove
one that only an older major exercises when the window moves past it.

## The three surfaces the policy governs

- **`PackageManagerInstaller`** in
  [`github-actions`](../modules/github-actions.md) — the artifact layouts
  it can provision, documented from the consumer's side in
  [`actions-storage`](../interfaces/actions-storage.md). For pnpm the two
  in-window layouts are: pnpm 11, a Node entry at `bin/pnpm.mjs`; and
  pnpm 12, a shebang-less placeholder `pnpm` bin plus an
  `@pnpm/exe.<os>-<arch>[-musl]` native binary overlaid from the same
  registry.[^installer]
- **[`npm`](../modules/npm.md)** and
  **[`package-json`](../modules/package-json.md)** — they model the
  **latest `package.json` shape as npm 11 and 12 define it**. Previous
  shapes and deprecated fields are out of scope; do not model a field
  only an out-of-window npm reads.

## Detect a layout by artifact, never by major

The major is a hint; the layout is the contract. Decide which provisioning
path applies from what the extracted manifest declares — pnpm's
native-binary layout is recognised by an `@pnpm/exe.*` entry in the
wrapper's `optionalDependencies`, not by `version >= 12` — so a layout that
moves inside a major, or a major that keeps its layout, is handled without
a version table to keep current.[^pnpm-exe] A version-keyed branch is
exactly the code this rule forbids adding.

## Outstanding

npm 12 is inside the window but **not yet adopted or verified** in the kit
as of 2026-09-17. `npm@12.0.2` is `latest`; its `engines.node` is
`^22.22.2 || ^24.15.0 || >=26.0.0`, which blocked adoption until the
Node 26.9.0 bump landed, and its `bin` shape is unchanged
(`bin/npm-cli.js`, `bin/npx-cli.js`), so adoption is expected to be a
verification-and-pin task rather than another installer change.[^npm-12]
The work spans the three repositories in the pin-upgrade flow — this one,
`savvy-web/silk-runtime-action` and `savvy-web/silk-update-action` — and
is tracked in a follow-up ticket in each.

[^owner]: The window, the three governed surfaces and the npm 12 status
    were stated by the repository owner on 2026-09-17.
[^installer]: `PackageManagerInstaller.ts` — the pnpm layout notes on
    `readPackageManifest` and the `overlayNativeBinary` step.
[^pnpm-exe]: `internal/pnpmExe.ts` — the module comment: detection is by
    layout, never by major version.
[^npm-12]: The `npm@12.0.2` packument: `dist-tags.latest`, `engines.node`
    and `bin`.
