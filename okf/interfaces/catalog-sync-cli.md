---
type: Interface
title: The catalog:sync / catalog:check CLI
description: Two root package.json scripts over lib/scripts/catalog-sync.ts that resolve every catalogued @effected/* package's next-release version, rewrite the effected catalog literal in packages/pnpm-plugin-effect/savvy.build.ts, and gate on both catalog membership and version drift.
status: stable
kind: cli
resource: ../../lib/scripts/catalog-sync.ts
tags:
  - release
  - ci
sources:
  - id: root-package-scripts
    resource: ../../package.json
  - id: catalog-sync-script
    resource: ../../lib/scripts/catalog-sync.ts
  - id: pnpm-plugin-effect-savvy-build
    resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 27046855d658d76c1de4163abfd42643c165345adbecc7d3e8252f53d129f2f7
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:14.366Z
---

# The catalog:sync / catalog:check CLI

## The pieces

- `lib/scripts/catalog-sync.ts` is the implementation behind both root
  `package.json` scripts:
  `"catalog:check": "tsx lib/scripts/catalog-sync.ts --check"` and
  `"catalog:sync": "tsx lib/scripts/catalog-sync.ts"`.[^root-package-scripts]
- The rewrite target is the `effected` catalog literal declared inline at
  the `PnpmConfigPlugin(...)` call site inside
  `packages/pnpm-plugin-effect/savvy.build.ts`.[^pnpm-plugin-effect-savvy-build]
  The literal must stay inline there — hoisting it into an exported
  `const` makes it invisible to the upstream `rolldown-pnpm-config
  upgrade` CLI that walks the call argument statically.
- `.github/workflows/catalog-sync.yml` is the CI job that runs this CLI
  against `main` on every pull request; see
  [the catalog-sync-check-goes-red-when-it-repairs gotcha](../gotchas/catalog-sync-check-goes-red-when-it-repairs.md).

## Commands

`catalog:check` — read-only. Runs `rolldown-pnpm-config upgrade` in
check mode plus this repo's own membership and ripple-drift computation,
and exits non-zero if either check finds anything wrong. It writes
nothing.

`catalog:sync` — the only writer. Rewrites the catalog literal in
`packages/pnpm-plugin-effect/savvy.build.ts` in place and writes one
fixed-name changeset (`.changeset/catalog-sync.md`) when anything moved.
Builds never write this file; only a human or a workflow invoking
`catalog:sync` deliberately does.

## What each command checks, and what it does not

The CLI answers three independent questions, and keeps them independent
on purpose:

- **Version drift on packages the catalog already names.** The upstream
  `rolldown-pnpm-config upgrade` walks the catalog literal and resolves
  each `source: "workspace"` entry against the local workspace plus
  pending changesets. `check` reports drift; `sync` rewrites it.
- **Membership** — whether every publishable package is named in the
  catalog at all. The upgrade CLI cannot see this, because a package
  absent from the literal is invisible to a walk of the literal.
  `lib/scripts/catalog-sync.ts` computes this itself
  (`catalogMembers`, `publishablePackages`, `missingFromCatalog`),
  reading the literal as source text the same way the CLI
  does.[^catalog-sync-script] `check` fails on a membership gap even
  when the upgrade CLI is green; `sync` refuses to run at all rather
  than writing a changeset for a catalog it knows is incomplete — see
  [closing a membership gap](../runbooks/close-a-catalog-membership-gap.md).
- **Ripple bumps** — a package changesets bump only as a dependency
  ripple, carrying no changeset of its own naming it. The upgrade CLI
  cannot see these either, since it resolves from `source: "workspace"`
  entries plus pending changesets and a ripple has neither. The sync
  script instead asks `changeset status --output` for the true release
  plan, ripples included, and `sync` rewrites the affected entries'
  `range` and floors the `peer` patch under the `lock-minor` strategy.

Publishability, for both membership questions, is always
`publishConfig.access === "public"`, never `private === false` — see
[the publishability-signal convention](../conventions/publishability-signal.md).

## Two output modes, two audiences

`catalog:sync` runs the upstream CLI with `--json`, used only for
**reporting** which entries moved. Whether the catalog moved at all is
decided separately, by diffing `savvy.build.ts` around the invocation —
the file is the artifact that matters, and a diff of it cannot disagree
with itself. A change in the upstream CLI's JSON shape can only degrade
the log line, never the verdict.

`catalog:check` deliberately stays on the upstream CLI's plain **text**
output; nothing parses it. It is the gate, and its stdout is what a human
reads in the run log behind a red check — the drift list, not a JSON
blob. `.github/workflows/release.yml` wires `catalog:check` as the
release's own `on-build` gate, keyed on the exit code alone.

## Exit codes

`catalog:check` exits non-zero on any of: version drift, a membership
gap, or ripple drift. It exits zero only when the catalog literal already
matches every catalogued package's actual next-release version and every
publishable package is named. `catalog:sync` exits non-zero only if a
membership gap makes it refuse to run; otherwise it exits zero whether or
not it wrote anything.

[^root-package-scripts]: `package.json:25-26` — the two script
    definitions for `catalog:check` and `catalog:sync`.
[^catalog-sync-script]: `lib/scripts/catalog-sync.ts:308,323,348` — the
    `catalogMembers`, `publishablePackages` and `missingFromCatalog`
    functions that compute membership independently of the upstream
    upgrade CLI.
[^pnpm-plugin-effect-savvy-build]: `packages/pnpm-plugin-effect/savvy.build.ts:11-20`
    — the inline `PnpmConfigPlugin({ ... })` call carrying the catalog
    literal the CLI rewrites.
