---
type: Consumer
title: silk-sync-action
description: "A GitHub-API-only consumer that syncs labels, settings and ProjectV2 membership across a repository fleet, and the register's test of partial kit adoption."
repository: savvy-web/silk-sync-action
status: stable
tags: [ci, bundle]
generated:
  by: okfit/claude-code
  at: 2026-09-13T05:33:04Z
sources:
  - id: repo
    resource: "https://github.com/savvy-web/silk-sync-action"
integrity:
  generated:
    body: 7aed87adf66b9640
---

# silk-sync-action

`savvy-web/silk-sync-action` synchronizes labels, repository settings and
ProjectV2 membership across a fleet of repositories, driven by a config
file. Its `package.json` dependencies confirm it is a GitHub-API-only
consumer: no subprocesses, no publishing, no supply chain —
[`@effected/github`](../modules/github.md),
[`@effected/github-actions`](../modules/github-actions.md), and
[`@effected/config-file`](../modules/config-file.md), and nothing else. This
register was last verified against the local checkout at
`/Users/spencer/workspaces/savvy-web/silk-sync-action` on 2026-09-02.

That narrowness is what makes this consumer useful in the register: it
tests whether the kit's API surface can be adopted partially.

## What it exercises

**The [route-keyed REST surface](../interfaces/github-rest-client.md), as
the argument for it.** This action reads and patches
[repository settings](../interfaces/github-resources.md), lists labels and
paginates issues. Before adopting the kit it re-derived octokit typings
repeatedly in one file — cast interfaces and a hand-declared repository
shape — because the client handed back `unknown`. It now names routes and
takes the kit's typed REST data and repository-patch shapes directly; the
interfaces that remain in its own reads module are domain projections it
chose, not descriptions of octokit it was forced to write.

**Consumer-owned GraphQL.** The ProjectV2 documents stay here as typed
[GraphQL document](../interfaces/github-graphql.md) values with typed
variables and decoded responses. The kit supplies the mechanism and the
typed error; ProjectV2 vocabulary is this repository's domain, and the
split is deliberate.

**Config reading as a one-shot.** A single config file, read once against a
schema, with no per-schema service standing behind it.

**Fan-out via a core combinator, not a named service.** Fan-out-and-
accumulate across a repository fleet was a named service in this
repository's predecessor; the kit deliberately ships no replacement, and
this repository's own per-repo processing step records `Effect.partition`
as the answer. No second consumer has asked for a combinator since.

## Where the kit's edge sits

- **ProjectV2 is this repository's domain** — the GraphQL documents, and
  what they mean.
- **Repository discovery** — enumeration by custom property or explicit
  list, and the de-dup keyed on lowercased full name.
- **The per-repo orchestration and fan-out policy**, and the app's own
  config and error vocabulary.

## Open questions

1. **A dead bundler-ignore entry is still there.** This action's build
   config stubs three packages, with a comment attributing them to a
   CycloneDX library arriving transitively through
   `@effected/github-actions` → `@effected/sbom`. That premise does not
   hold: `@effected/sbom` declines the CycloneDX library outright, and
   none of the three stubbed packages is installed in this consumer's tree
   at all. Per-package splitting removed the need for the escape hatch by
   construction — the consumer just never deleted the stub, so its comment
   documents a dependency graph that does not exist. Worth carrying
   because it is the failure mode of a successful upstream fix: nothing
   breaks, so nobody cleans up.
2. **The seam edge that does cost something is the sigstore signing
   stack.** [`@effected/github-actions`](../modules/github-actions.md)
   depends on [`@effected/sbom`](../modules/sbom.md) for two small adapter
   modules, so every consumer of the Actions package installs
   `@effected/sbom`'s runtime dependencies — the sigstore stack among them —
   whether or not it ever signs anything. The kit's reachability tests
   confine those modules in the import graph, which is what lets a
   tree-shaking bundler drop them given a side-effect-free package marker;
   they say nothing about the resolver graph, where a declared dependency
   is installed regardless. Import-graph confinement is not resolver-graph
   absence, and only a consumer that bundles or audits its install tree
   finds the difference.
