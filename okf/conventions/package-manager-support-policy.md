---
type: Convention
title: Package-manager support window
description: "The kit supports npm (the current major plus the major the active LTS Node bundles: 11 and 12), pnpm 12 only and bun current; yarn is unsupported except manager-neutral workspace discovery through package.json#workspaces. An artifact layout is detected by what the manifest declares, never by major; older majors get no code paths, tests, fixtures or docs."
status: stable
stale_after: 2027-03-17T00:00:00Z
tags:
  - compat
  - deps
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-12T00:00:00Z
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
  at: 2026-11-12T21:41:04Z
integrity:
  generated:
    body: 1319312cfba9fb78
---

# Package-manager support window

The kit supports three package managers, each on its own window, and
nothing older.[^owner]

- **npm** is the current major plus the major the active LTS Node bundles.
  Today that is npm 11 and 12: Node 26.13.0 bundles npm 11.20.0, so a kit
  tool shelling out to the installed npm on a stock Node gets npm 11. The
  window moves when the active LTS Node's bundled npm moves.
- **pnpm** is the current major only, pnpm 12. Every kit consumer already
  pins it. Dual-major support can return at the next major if needed, and
  nothing in the kit records which pnpm major a setting applies to.
- **bun** is the current major.
- **yarn is unsupported.** No kit project uses it. The one deliberate
  exception is workspace discovery, which stays manager-neutral: a yarn
  repository declares its members in `package.json#workspaces`, exactly as
  npm does, so root and member discovery keep working on it through the
  npm-shaped path.

An older major is not a compatibility target: do not add a code path, a
test, a fixture or a paragraph of documentation for it, and remove one that
only an older major exercises when the window moves past it.

## The three surfaces the policy governs

- **`PackageManagerInstaller`** in
  [`github-actions`](../modules/github-actions.md) — the artifact layouts
  it can provision, documented from the consumer's side in
  [`actions-storage`](../interfaces/actions-storage.md). For pnpm the one
  in-window layout is pnpm 12's: a shebang-less placeholder `pnpm` bin plus
  an `@pnpm/exe.<os>-<arch>[-musl]` native binary overlaid from the same
  registry.[^installer]
- **[`npm`](../modules/npm.md)** and
  **[`package-json`](../modules/package-json.md)** — they model the
  **latest `package.json` shape as npm 11 and 12 define it**, and tolerate
  both majors' program output (the array form of `npm pack --json` stays
  alongside the name-keyed one). Previous shapes and deprecated fields are
  out of scope; do not model a field only an out-of-window npm reads.
- **The per-manager packages and the lockfile readers** — a manager's
  settings, config files and lockfile grammar are modelled for the window
  above and no further: npm 11 and 12, pnpm 12, bun current.

## Detect a layout by artifact, never by major

The major is a hint; the layout is the contract. Decide which provisioning
path applies from what the extracted manifest declares — pnpm's
native-binary layout is recognised by an `@pnpm/exe.*` entry in the
wrapper's `optionalDependencies`, not by `version >= 12` — so a layout that
moves inside a major, or a major that keeps its layout, is handled without
a version table to keep current.[^pnpm-exe] A version-keyed branch is
exactly the code this rule forbids adding.

## What moving the window costs

Moving the window to a new major is never "verification only" by default;
each earlier move found one real break, each in a different surface. pnpm 12
changed the *artifact*: the `pnpm` bin became a placeholder for a native
binary, and provisioning it needed the overlay step. npm 12 changed a
*program output* the kit decodes: `npm pack --json` went from an array to an
object keyed by package name, and `PackagePublish` rejected every npm 12
answer as unreadable until it accepted both shapes.[^npm-pack-json][^publish]
The installer itself needed no change for npm 12: `npm@12.0.2`'s `bin` is
unchanged, and a runtime probe provisioned `npm@12.0.2` and `npm@11.19.1`
into a tool cache with both shims answering `npm --version`.[^npm-12]

The third surface, the manifest fields, was swept for npm 12 and found
nothing to model. npm 12 adds three root-only fields — `allowScripts`,
`packageExtensions` and `patchedDependencies` — each project policy with no
kit behaviour attached, so each rides through `PackageManifest`'s `rest`
untyped. The rule that decided it: a root-only field the kit never reads
stays in `rest`; a field is typed when a kit surface consumes it.

The installer does not read an artifact's `engines.node` against the
runner's node. `npm@12.0.2` declares `^22.22.2 || ^24.15.0 || >=26.0.0`;
pinned under a node outside that set it installs, runs, and prints npm's
own unsupported-node warning on every invocation. Keeping the node pin and
the manager pin coherent is the consumer's job.

When the window moves next, sweep three things: the artifact layout the
installer extracts, every `--json` output the kit decodes from the manager,
and the manifest fields the manager reads or writes. Read the release
notes' breaking-change list against those three, then prove each with a
probe rather than trusting "bin shape unchanged" as the whole story.

[^owner]: The window and the governed surfaces were stated by the
    repository owner on 2026-09-17; the 2026-11-12 narrowing (npm 11 and
    12 by LTS-bundled npm, pnpm 12 only, bun current, yarn unsupported)
    is the owner's design call for the package-manager model branch.
[^installer]: `PackageManagerInstaller.ts` — the pnpm layout notes on
    `readPackageManifest` and the `overlayNativeBinary` step.
[^pnpm-exe]: `internal/pnpmExe.ts` — the module comment: detection is by
    layout, never by major version.
[^npm-12]: The `npm@12.0.2` packument: `dist-tags.latest`, `engines.node`
    and `bin`. Runtime probe 2026-09-18 on macOS arm64 against the real
    registry.
[^npm-pack-json]: The gotcha recording the `pack --json` shape change and
    the tell in `PublishError`.
[^publish]: `PackagePublish.ts` — the `PackJson` codec accepting both the
    array and the name-keyed shape.
