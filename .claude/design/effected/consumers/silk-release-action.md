---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/commands.md
  - ../packages/git.md
  - ../packages/github-references.md
  - ../packages/npm.md
  - ../packages/sbom.md
  - ../github-action-canon.md
---

# silk-release-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-release-action` is the release pipeline: it detects the workflow phase, cuts and syncs a release branch, validates builds, packs and publishes to npm/JSR/GitHub Packages, builds SBOMs and attestations, cuts GitHub releases with assets, and links and closes the issues a release resolves.

It is the kit's widest consumer — its phases reach `github`, `github-actions`, `commands`, `git`, `npm`, `workspaces`, `sbom`, `markdown`, `github-references`, `package-json` and `jsonc` — and it is one of the three actions the [action canon](../github-action-canon.md) was derived from.

## What it exercises

**The supply chain, alone.** This is the only consumer that mints an OIDC token, builds an SBOM, signs it and attests it, and then publishes to a registry. `@effected/sbom` and `@effected/npm`'s `PackagePublish` exist at their current shape because this pipeline asked for them, and no second consumer has yet tested that shape.

**The publishability seam.** It supplies its own `PublishabilityDetector` — silk's policy, implemented against the kit's contract — which is the case the seam was designed for: the kit owns the question, the release tool owns the answer. `VersioningStrategy` and `ReleaseTag` serve it from `@effected/workspaces`.

**The GitHub write surface.** Branch upsert and reset, commit trees, tags, releases and assets, pull requests, check runs with byte-budgeted output, and issue linking through GraphQL. It is the heaviest user of `@effected/github`'s mutating members and the reason several of them carry sequencing warnings in their TSDoc.

**Managed regions, and a rule that improved out of the swap.** The release PR body and its sticky comments are section-per-region documents written by `ManagedDocument` from `@effected/github-actions` — which is how `@effected/templates` reaches this pipeline, transitively rather than as a declared dependency. `src/utils/managed-sections.ts` kept the five rules it owns about *when* a section is written (transition-before-work, superseded rather than blanked, sha-stamped, independent, monotonic) and deleted the region scanning and splicing underneath them. Rule 3 got stronger for the move: the stamp lives in region **metadata**, which round-trips verbatim and survives writes by parties that do not know it is there, where it used to be an in-content HTML comment that a whole-section re-render had to rewrite. That is the shape to expect when a mechanism moves up — the consumer keeps its policy and its invariants get cheaper to hold.

**Registry labelling, and the refusal it overturned.** This consumer carried a `src/utils/registry-label.ts` rendering a registry as both a short table label and a spelled-out name — the hand-roll that retired `@effected/npm`'s standing refusal to ship a display name ([npm.md](../packages/npm.md#registrykind--one-classification-not-four-predicates)). The file is deleted and four release modules import `registryShortLabel` / `registryDisplayName` / `registryHost` instead; the consumer's own test survives as an **adoption guard on the rendered strings**, which is the right residue for a projection that moved upstream.

**The credential union's silent-break, caught before it shipped.** This pipeline's probe passed a bearer token through a conditional spread, which is why renaming `RegistryTarget.token` to `credential` would have been silent rather than loud — the surviving `never` tripwire in `@effected/npm` exists because this consumer read the failure chain through to "republish a version that already exists" and said so.

**Composition over absorption.** The mint→sign→SBOM→attest ordering stays here as consumer composition rather than becoming a kit pipeline, on the argument that the ordering is release policy and the pieces are not.

## Where the kit's edge sits

- **Release policy** — phase detection rules, which registries to target, changeset and versioning configuration, and what the report and summary say. The kit supplies the mechanism; what a release *decides* is this repo's.
- **`@savvy-web/silk-effects`** — `Changesets`, `ChangesetConfig` and `SilkPublishability` stay downstream. The kit deliberately owns no changesets engine.
- **Changeset counting** — `src/utils/count-changesets.ts` reads the target branch's `.changeset` directory without a checkout, built from `@effected/git`'s `lsTree`/`show` and `@effected/markdown`'s frontmatter. This is the intended shape: a consumer composing kit primitives into its own domain operation rather than waiting for a `@effected/changesets` that is not planned.
- **Build validation and report shaping** — how a release reads, not how it works.

## Open questions

1. **`@effected/archive` was never built.** `src/release/meta-archive.ts` still shells `tar` through `Run` to pack a bundler `meta/` folder. The package was to be built at the first attestation need for byte-reproducible artifacts; that need has not forced it. It is no longer the *only* `tar` shell-out in play, though: [`PackageTarball`](../packages/npm.md#packagetarball--reading-a-published-package-back) makes the same call inside the kit, deliberately, to hold `@effected/npm` at boundary tier. Read that as evidence the archive package would have to justify its own tier before it justified its API.
2. **The supply-chain surface has one consumer.** `@effected/sbom`'s shape is validated by this pipeline alone. A second consumer is the only thing that would distinguish a general design from a faithful transcription of one.
