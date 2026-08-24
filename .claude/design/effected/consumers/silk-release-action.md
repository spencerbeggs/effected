---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-23
last-synced: 2026-08-23
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/commands.md
  - ../packages/npm.md
  - ../packages/sbom.md
  - ../github-action-canon.md
---

# silk-release-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-release-action` is the release pipeline: it detects the workflow phase, cuts and syncs a release branch, validates builds, packs and publishes to npm/JSR/GitHub Packages, builds SBOMs and attestations, cuts GitHub releases with assets, and links and closes the issues a release resolves.

It is the kit's widest consumer — its phases reach `github`, `github-actions`, `commands`, `git`, `npm`, `workspaces`, `sbom`, `markdown`, `templates`, `package-json` and `jsonc` — and it is one of the three actions the [action canon](../github-action-canon.md) was derived from.

## What it exercises

**The supply chain, alone.** This is the only consumer that mints an OIDC token, builds an SBOM, signs it and attests it, and then publishes to a registry. `@effected/sbom` and `@effected/npm`'s `PackagePublish` exist at their current shape because this pipeline asked for them, and no second consumer has yet tested that shape.

**The publishability seam.** It supplies its own `PublishabilityDetector` — silk's policy, implemented against the kit's contract — which is the case the seam was designed for: the kit owns the question, the release tool owns the answer. `VersioningStrategy` and `ReleaseTag` serve it from `@effected/workspaces`.

**The GitHub write surface.** Branch upsert and reset, commit trees, tags, releases and assets, pull requests, check runs with byte-budgeted output, and issue linking through GraphQL. It is the heaviest user of `@effected/github`'s mutating members and the reason several of them carry sequencing warnings in their TSDoc.

**Registry labelling, and the refusal it overturned.** This consumer carried a `src/utils/registry-label.ts` rendering a registry as both a short table label and a spelled-out name — the hand-roll that retired `@effected/npm`'s standing refusal to ship a display name ([npm.md](../packages/npm.md#registrykind--one-classification-not-four-predicates)). The file is deleted and four release modules import `registryShortLabel` / `registryDisplayName` / `registryHost` instead; the consumer's own test survives as an **adoption guard on the rendered strings**, which is the right residue for a projection that moved upstream.

**The credential union's silent-break, caught before it shipped.** This pipeline's probe passed a bearer token through a conditional spread, which is why renaming `RegistryTarget.token` to `credential` would have been silent rather than loud — the surviving `never` tripwire in `@effected/npm` exists because this consumer read the failure chain through to "republish a version that already exists" and said so.

**Composition over absorption.** The mint→sign→SBOM→attest ordering stays here as consumer composition rather than becoming a kit pipeline, on the argument that the ordering is release policy and the pieces are not.

## Where the kit's edge sits

- **Release policy** — phase detection rules, which registries to target, changeset and versioning configuration, and what the report and summary say. The kit supplies the mechanism; what a release *decides* is this repo's.
- **`@savvy-web/silk-effects`** — `Changesets`, `ChangesetConfig` and `SilkPublishability` stay downstream. The kit deliberately owns no changesets engine.
- **Changeset counting** — `src/utils/count-changesets.ts` reads the target branch's `.changeset` directory without a checkout, built from `@effected/git`'s `lsTree`/`show` and `@effected/markdown`'s frontmatter. This is the intended shape: a consumer composing kit primitives into its own domain operation rather than waiting for a `@effected/changesets` that is not planned.
- **Build validation and report shaping** — how a release reads, not how it works.

## Linking this consumer to an unreleased kit

A dogfood round against unpublished builds found a trap worth carrying, because its failure mode is a **green typecheck**: a plain `link:` (or `file:`, which pnpm resolves as a link for a directory) leaves the linked package resolving `effect` and its `@effected` siblings from the *kit's* tree, putting a second `effect` instance in the process. The visible half is honest — type identity errors, "two different types with this name exist" — and chasing it by linking each clashing sibling in turn makes the typecheck pass, which is the trap. The invisible half is runtime: schema class adapters failing across the instance seam, an all-strings table cell coming back a non-string, **93 of 871 tests failing** where the unlinked tree passed all of them.

The fix is `file:` **plus `dependenciesMeta.<pkg>.injected: true`**, so pnpm materializes a real copy whose dependencies resolve from the consumer's tree — one `effect`, one of everything, and no sibling overrides at all. Two operational notes travel with it: after changing an injected override the lockfile must be cleaned (a plain install replays the stale resolution and silently keeps the previous link), and the first install can leave a dangling symlink a second install materializes.

## Open questions

1. **`@effected/archive` was never built.** `src/release/meta-archive.ts` still shells `tar` through `Run` to pack a bundler `meta/` folder. The package was to be built at the first attestation need for byte-reproducible artifacts; that need has not forced it. It is no longer the *only* `tar` shell-out in play, though: [`PackageTarball`](../packages/npm.md#packagetarball--reading-a-published-package-back) makes the same call inside the kit, deliberately, to hold `@effected/npm` at boundary tier. Read that as evidence the archive package would have to justify its own tier before it justified its API.
2. **The supply-chain surface has one consumer.** `@effected/sbom`'s shape is validated by this pipeline alone. A second consumer is the only thing that would distinguish a general design from a faithful transcription of one.
