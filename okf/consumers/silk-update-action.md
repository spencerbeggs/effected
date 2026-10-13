---
type: Consumer
title: silk-update-action
description: "The kit's widest consumer of its monorepo half: resolves registry versions, rewrites catalogs and manifests, upgrades runtimes, and opens dependency-update PRs."
repository: savvy-web/silk-update-action
status: stable
tags: [ci, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-27T19:57:47Z
sources:
  - id: repo
    resource: "https://github.com/savvy-web/silk-update-action"
integrity:
  generated:
    body: de1e5d9611cc8fe3
---

# silk-update-action

`savvy-web/silk-update-action` keeps a repository's dependencies current: it
resolves registry versions, rewrites catalogs and manifests, upgrades the
package manager and the runtime, runs the install, emits changesets and opens
the update pull request.

Its `package.json` dependencies confirm the reach:
[`@effected/workspaces`](../modules/workspaces.md),
[`@effected/npm`](../modules/npm.md),
[`@effected/runtimes`](../modules/runtimes.md),
[`@effected/lockfiles`](../modules/lockfiles.md),
[`@effected/semver`](../modules/semver.md),
[`@effected/yaml`](../modules/yaml.md),
[`@effected/commands`](../modules/commands.md),
[`@effected/git`](../modules/git.md),
[`@effected/github`](../modules/github.md) and
[`@effected/github-actions`](../modules/github-actions.md) — this is the
widest use of the kit's monorepo half, as distinct from
[silk-release-action](silk-release-action.md)'s supply-chain half. This
register was last verified against the local checkout at
`/Users/spencer/workspaces/savvy-web/silk-update-action` on 2026-09-02.

## What it exercises

**The registry axis.** The kit's npm registry service is keyed
registry → package → version, and this repository is what proved the axis:
its release-age gate asks about publish times for specific versions from
specific registries, which a package-keyed model could not answer. Its own
release-age service composes the kit's registry client and gate over
[`@effected/workspaces`](../modules/workspaces.md)'s
[catalog release-age check](../interfaces/workspaces-release.md) —
discovery on one side of the seam, registry facts on the other.

**Catalog and lockfile reality.** pnpm catalogs, `configDependencies`,
[workspace discovery](../interfaces/workspaces-discovery.md), the
[dependency graph](../interfaces/workspaces-graph.md) and lockfile reading
via [`@effected/lockfiles`](../modules/lockfiles.md), all against a real
monorepo rather than a fixture. It is the kit's most demanding
`@effected/workspaces` consumer after the internal `systems` repository.

**A hand-roll that became kit surface.** This repository's own SRI-to-
corepack hash conversion is now a named conversion in
[`@effected/npm`](../modules/npm.md). The generalizing part is why it could
not stay downstream: the two spellings are both kit-typed vocabulary, so a
consumer converting between them by hand was re-deciding the kit's own edge
cases — non-sha512 input, non-canonical base64, JSON-quoted registry
values — one call site at a time.

**Runtime resolution as a manifest concern.**
[`@effected/runtimes`](../modules/runtimes.md) resolves which Node, Bun or
Deno version satisfies a range; this repository is what makes that useful,
because it then writes the answer into a manifest's runtime-engines field.

**The peer gate.** Its peer-check step judges the post-install lockfile with
[`PeerCheck`](../interfaces/workspaces-peer-check.md), after refreshing
`WorkspaceCatalogs` so the suppression rules are the after-state ones, and
degrades a failed rules lookup to omitting the option — landing on the
fail-closed `peerRulesNotApplied` path rather than asserting an empty rule
set. It passes `peerDependencyRules` only
(`src/steps/peer-check.ts:123`, checked 2026-09-27). `PeerCheck` also takes
`workspacePackages` and `catalogs`, and without them every `link:`-resolved
workspace dependency keeps the report `unresolvedEdge`, which under pnpm is
every internal `workspace:` edge; supplying both — from `WorkspaceDiscovery`
and `WorkspaceCatalogs.set()`, which this step already has in reach — is
what lets the gate judge a linked parent's peers instead of refusing them.

## Where the kit's edge sits

- **The update policy itself** — which dependency sections to touch, the
  peer-sync rules, the three-way catalog merge, and the changeset a run
  emits.
- **The changesets engine** stays downstream in `@savvy-web/silk-effects`;
  it is policy.
- **Reading and rewriting a manifest's runtime-engines field** —
  deliberately pure and manifest-shaped: [`@effected/runtimes`](../modules/runtimes.md)
  resolves versions and has no opinion about where they are written.
- **Pure catalog-map, pnpm-version and `configDependencies` helpers** over
  the manifest's own shape.
- **The fetch-a-config-dependency-tarball-and-import-it flow** — now only
  the import half. Fetch-verify-extract and entry-point resolution moved
  into [`@effected/npm`](../modules/npm.md)'s package-reading surface and
  [`@effected/package-json`](../modules/package-json.md)'s
  [entry-point resolver](../interfaces/package-json-text.md); what stays
  here is the dynamic `import()` of the resolved path, deliberately,
  because a computed-path import is compiled into a context module by
  bundlers and the kit will not hand every bundling consumer that problem
  with no seam to fix it.

## Open questions

1. **Catalog-field semantics are expressed twice.** This repository coerces
   pnpm's `catalog`/`catalogs` fields into a plain record while
   `@effected/workspaces` ships its own discovered view over the same
   fields. The two serve different needs — one is a pure manifest-shaped
   helper, the other a discovered view — but whether that distinction is
   worth two implementations has never been decided.
2. **The tarball fetch-extract-import pattern appears twice here**, and it
   is half-answered rather than closed. Fetch-verify-extract and entry
   lookup both moved into the kit, driven by this flow; the loading half
   stays downstream on purpose. What is still open is whether the two call
   sites here collapse onto one composition, and whether a general archive
   package is ever warranted — see
   [silk-release-action](silk-release-action.md#open-questions), which
   holds the other `tar` shell-out.
3. **Its peer gate supplies one of `PeerCheck`'s three option keys.** Until
   it also passes `workspacePackages` and `catalogs`, a pnpm monorepo with
   internal dependencies can never produce a verified peer report through
   this gate: with the gate enforcing and auto-merge enabled, its
   `decidePeerGate` withholds auto-merge as `unverified` on every run there
   (`src/utils/peers.ts`).
