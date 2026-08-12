---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
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

**Composition over absorption.** The mint→sign→SBOM→attest ordering stays here as consumer composition rather than becoming a kit pipeline, on the argument that the ordering is release policy and the pieces are not.

## Where the kit's edge sits

- **Release policy** — phase detection rules, which registries to target, changeset and versioning configuration, and what the report and summary say. The kit supplies the mechanism; what a release *decides* is this repo's.
- **`@savvy-web/silk-effects`** — `Changesets`, `ChangesetConfig` and `SilkPublishability` stay downstream. The kit deliberately owns no changesets engine.
- **Changeset counting** — `src/utils/count-changesets.ts` reads the target branch's `.changeset` directory without a checkout, built from `@effected/git`'s `lsTree`/`show` and `@effected/markdown`'s frontmatter. This is the intended shape: a consumer composing kit primitives into its own domain operation rather than waiting for a `@effected/changesets` that is not planned.
- **Build validation and report shaping** — how a release reads, not how it works.

## Open questions

1. **`@effected/archive` was never built.** `src/release/meta-archive.ts` still shells `tar` through `Run` to pack a bundler `meta/` folder. The package was to be built at the first attestation need for byte-reproducible artifacts; that need has not forced it, and this remains the single surveyed `tar` shell-out in the consumer set.
2. **The supply-chain surface has one consumer.** `@effected/sbom`'s shape is validated by this pipeline alone. A second consumer is the only thing that would distinguish a general design from a faithful transcription of one.
