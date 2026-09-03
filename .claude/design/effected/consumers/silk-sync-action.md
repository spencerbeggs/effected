---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/config-file.md
  - ../packages/sbom.md
---

# silk-sync-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-sync-action` synchronizes labels, repository settings and ProjectV2 membership across a fleet of repositories, driven by a config file. It is a GitHub-API-only consumer: no subprocesses, no publishing, no supply chain — `@effected/github`, `@effected/github-actions` and `@effected/config-file`, and nothing else.

That narrowness is what makes it useful here. It is the consumer that tests whether the kit's API surface can be adopted *partially*.

## What it exercises

**The route-keyed REST surface, as the argument for it.** This action reads and patches repository settings, lists labels and paginates issues. Before the kit it re-derived octokit typings repeatedly in one file — cast interfaces and a hand-declared repository shape — because the client handed back `unknown`. It now names routes and takes `Rest.Data` / `RepositoryPatch` directly; the interfaces that remain in `src/github/reads.ts` are domain projections it chose, not descriptions of octokit it was forced to write.

**Consumer-owned GraphQL.** The ProjectV2 documents stay here as `GraphQLDocument` values with typed variables and decoded responses. The kit supplies the mechanism and the typed error; ProjectV2 vocabulary is this repo's domain, and the split is deliberate.

**`ConfigFile.read` as a one-shot.** A single config file, read once against a schema, with no per-schema service standing behind it.

**`Effect.partition` in place of an accumulator.** Fan-out-and-accumulate across a repository fleet was a named service in the predecessor; the kit deliberately ships no replacement, and this repo's `src/sync/processRepos.ts` records `Effect.partition` as the answer. No second consumer has asked for a combinator since.

## Where the kit's edge sits

- **ProjectV2 is this repo's domain** — the GraphQL documents, and what they mean.
- **`src/discovery/`** — repository enumeration by custom property or explicit list, and the de-dup keyed on lowercased full name.
- **The per-repo orchestration and fan-out policy**, and the app's own config and error vocabulary.

## Open questions

1. **The CycloneDX bundler `ignore` is dead code and is still there.** The action's `action.config.ts` stubs `xmlbuilder2`, `libxmljs2` and `ajv-formats-draft2019`, with a comment attributing them to `@cyclonedx/cyclonedx-library` arriving transitively through `@effected/github-actions` → `@effected/sbom`. That premise does not hold: `@effected/sbom` declines the CycloneDX library outright, and none of the three stubbed packages is installed in this consumer's tree at all. Per-package splitting removed the need for the escape hatch by construction — the consumer just never deleted the stub, so its comment documents a dependency graph that does not exist. Worth carrying because it is the failure mode of a *successful* upstream fix: nothing breaks, so nobody cleans up.

2. **The seam edge that does cost something is `@sigstore/*`.** `@effected/github-actions` depends on `@effected/sbom` for two small adapter modules, so every consumer of the Actions package installs sbom's runtime dependencies — the sigstore signing stack among them — whether or not it ever signs anything. The kit's reachability tests confine those modules in the **import** graph, which is what lets a tree-shaking bundler drop them given `"sideEffects": false`; they say nothing about the **resolver** graph, where a declared dependency is installed regardless. Import-graph confinement is not resolver-graph absence, and only a consumer that bundles or audits its install tree finds the difference.
