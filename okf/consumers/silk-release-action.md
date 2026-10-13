---
type: Consumer
title: silk-release-action
description: "The kit's supply-chain and GitHub-write-surface consumer: detects release phase, publishes to npm/JSR/GitHub Packages, builds and attests SBOMs, and cuts GitHub releases."
repository: savvy-web/silk-release-action
status: stable
tags: [ci, release]
generated:
  by: okfit/claude-code
  at: 2026-09-13T05:33:04Z
sources:
  - id: repo
    resource: "https://github.com/savvy-web/silk-release-action"
integrity:
  generated:
    body: da7576ca3f047807
---

# silk-release-action

`savvy-web/silk-release-action` is the release pipeline: it detects the
workflow phase, cuts and syncs a release branch, validates builds, packs and
publishes to npm, JSR and GitHub Packages, builds SBOMs and attestations,
cuts GitHub releases with assets and links, and closes the issues a release
resolves.

It is the kit's widest single consumer. Its `package.json` dependencies
confirm the reach: [`@effected/github`](../modules/github.md),
[`@effected/github-actions`](../modules/github-actions.md),
[`@effected/workspaces`](../modules/workspaces.md),
[`@effected/markdown`](../modules/markdown.md),
[`@effected/commands`](../modules/commands.md),
[`@effected/git`](../modules/git.md),
[`@effected/github-references`](../modules/github-references.md),
[`@effected/npm`](../modules/npm.md), [`@effected/sbom`](../modules/sbom.md),
[`@effected/package-json`](../modules/package-json.md),
[`@effected/semver`](../modules/semver.md), and
[`@effected/jsonc`](../modules/jsonc.md) — this register was last verified
against the local checkout at `/Users/spencer/workspaces/savvy-web/silk-release-action`
on 2026-09-02.

## What it exercises

**The supply chain, alone.** This is the only consumer that mints an OIDC
token, builds an SBOM, signs it and attests it, and then publishes to a
registry. [`@effected/sbom`](../modules/sbom.md) and
[`@effected/npm`](../modules/npm.md)'s package-publish surface exist at
their current shape because this pipeline asked for them, and no second
consumer has yet tested that shape.

**The publishability seam.** It supplies its own publishability detector —
silk's policy, implemented against the kit's contract — which is the case
the seam was designed for: the kit owns the question, the release tool owns
the answer. Versioning strategy and release-tag classification are served
from [`@effected/workspaces`](../modules/workspaces.md)'s
[release surface](../interfaces/workspaces-release.md).

**The GitHub write surface.** Branch upsert and reset, commit trees, tags,
releases and assets, pull requests, check runs with byte-budgeted output,
and issue linking through GraphQL. It is the heaviest user of
[`@effected/github`](../modules/github.md)'s mutating members.

**Managed regions.** The release PR body and its sticky comments are
section-per-region documents written by a managed-document facility from
[`@effected/github-actions`](../modules/github-actions.md). The consumer
keeps the policy about *when* a section is written (transition-before-work,
superseded rather than blanked, sha-stamped, independent, monotonic); the
region scanning and splicing mechanism, and the sha-stamp living in region
metadata rather than an in-content HTML comment, are the kit's.

**Registry labelling.** This consumer previously hand-rolled a registry
label renderer; it now imports the kit's registry short-label,
display-name and host projections from [`@effected/npm`](../modules/npm.md)
instead, with its own test surviving as an adoption guard on the rendered
strings.

**Composition over absorption.** The mint-sign-SBOM-attest ordering stays
in this repository as consumer composition rather than becoming a kit
pipeline: the ordering is release policy, and the pieces are not.

## Where the kit's edge sits

- **Release policy** — phase detection rules, which registries to target,
  changeset and versioning configuration, and what the report and summary
  say. The kit supplies the mechanism; what a release *decides* is this
  repository's.
- **The changesets engine** stays downstream in `@savvy-web/silk-effects`.
  The kit deliberately owns no changesets engine.
- **Changeset counting** reads the target branch's `.changeset` directory
  without a checkout, built from [`@effected/git`](../modules/git.md)'s
  tree/show primitives and [`@effected/markdown`](../modules/markdown.md)'s
  [frontmatter reader](../interfaces/markdown-frontmatter.md) — a consumer
  composing kit primitives into its own domain operation rather than
  waiting for a changesets package the kit does not own.
- **Build validation and report shaping** — how a release reads, not how
  it works.

## Open questions

1. **No archive package exists.** This pipeline shells out to `tar` to pack
   a bundler metadata folder into a byte-reproducible artifact, and nothing
   has yet needed that badly enough to justify a kit package for it. The
   kit itself makes an equivalent `tar` shell-out reading a published
   package back, deliberately, to keep that surface at boundary tier — an
   archive package would have to justify its own tier before it justified
   its API.
2. **The supply-chain surface has one consumer.** `@effected/sbom`'s shape
   is validated by this pipeline alone. A second consumer is the only thing
   that would distinguish a general design from a faithful transcription of
   one.
