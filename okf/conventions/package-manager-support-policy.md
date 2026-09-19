---
type: Convention
title: Support the current major and one back of every package manager
description: The kit provisions and models the current major and one major back of every package manager — pnpm 11 + 12 and npm 11 + 12, both pairs verified as of 2026-09-18 — detecting an artifact layout by what the manifest declares, never by major; older majors get no code paths, tests, fixtures or docs.
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
  - id: npm-pack-json
    resource: ../gotchas/npm-12-pack-json-is-keyed-by-name.md
  - id: publish
    resource: ../../packages/npm/src/PackagePublish.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-19T02:28:19Z
  body_sha256: 7704cfe3b9345f7cd49e55d870566e107d2e303489a22439f233a00bdc54dc2e
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

## What the window has cost so far

Moving the window to a new major is never "verification only" by default;
each of the two moves so far found one real break, and each in a different
surface. pnpm 12 changed the *artifact*: the `pnpm` bin became a placeholder
for a native binary, and provisioning it needed the overlay step. npm 12
changed a *program output* the kit decodes: `npm pack --json` went from an
array to an object keyed by package name, and `PackagePublish` (which
shells `pack --json` for `pack` and `dryRun`) rejected every npm 12 answer
as unreadable until it accepted both shapes.[^npm-pack-json][^publish] The
installer itself needed no change for npm 12 — `npm@12.0.2`'s `bin` is
unchanged (`bin/npm-cli.js`, `bin/npx-cli.js`) — and the verification is a
runtime probe: both `npm@12.0.2` and `npm@11.19.1` provisioned into a tool
cache and answering `npm --version` through their shims, with the
same-major near miss (ambient `12.0.1` for a `12.0.2` pin) going to the
tool cache rather than being accepted as close enough.[^npm-12]

The installer does not read an artifact's `engines.node` against the
runner's node. `npm@12.0.2` declares `^22.22.2 || ^24.15.0 || >=26.0.0`;
pinned under a node outside that set (24.9.0, say) it installs, runs, and
prints `npm warn cli npm v12.0.2 does not support Node.js v24.9.0` on
every invocation. Keeping the node pin and the manager pin coherent is the
consumer's job, made where it pins node; the kit surfaces nothing beyond
npm's own warning.

When the window moves next, sweep three things: the artifact layout the
installer extracts, every `--json` output the kit decodes from the manager,
and the manifest fields the manager reads or writes. Read the release
notes' breaking-change list against those three, then prove each with a
probe rather than trusting "bin shape unchanged" as the whole story.

[^owner]: The window, the three governed surfaces and the npm 12 status
    were stated by the repository owner on 2026-09-17.
[^installer]: `PackageManagerInstaller.ts` — the pnpm layout notes on
    `readPackageManifest` and the `overlayNativeBinary` step.
[^pnpm-exe]: `internal/pnpmExe.ts` — the module comment: detection is by
    layout, never by major version.
[^npm-12]: The `npm@12.0.2` packument: `dist-tags.latest`, `engines.node`
    and `bin`; runtime probe 2026-09-18 (`scratchpad/probes/npm12.ts`, macOS
    arm64, node 26.9.0 / 24.9.0 / 22.23.2).
[^npm-pack-json]: The gotcha recording the `pack --json` shape change and
    the tell in `PublishError`.
[^publish]: `PackagePublish.ts` — the `PackJson` codec accepting both the
    array and the name-keyed shape.
