---
type: Decision
title: Azure is confined to three modules, not two
description: The Azure blob client may only be imported by ActionCache, Artifact and BlobStore.githubCache — not by any shared internal helper.
status: stable
tags:
  - bundle
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: e04e7165d8d74c4ef00c3ae09daafe8e957930422e18a3c06f506e6cea983bc2
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# Azure is confined to three modules, not two

## Context

`@effected/github-actions` requires: a consumer that imports only an
outputs accessor must be unable to link `@azure/storage-blob`, the
package's heaviest external dependency
(`packages/github-actions/src/ActionCache.ts`,
`packages/github-actions/src/Artifact.ts`,
`packages/github-actions/src/BlobStore.githubCache.ts`). An outside
reading of the subsystem — "there's a cache and there's a blob store" —
suggests two modules need it. The Actions cache's own protocol hands back
an Azure blob URL for the payload, so the cache module needs the client
too, which makes three.

## Decision

Azure is imported by exactly these three protocol modules and nowhere
else. No shared helper under `packages/github-actions/src/internal/` may
import it, because an internal helper is exactly how a heavy import leaks
into a light module's graph. The three are separate named exports in
`index.ts`, never gathered into a namespace object — see
[no barrel re-exports](../conventions/no-barrel-re-exports.md) — since a
convenience object would make every one of them reachable from any of
them. `@effected/markdown` (confined to `GitHubMarkdown.ts`) and
`@effected/npm` (confined to `PackageManagerInstaller.ts`) are held to the
same rule for the same reason.

The confinement is checked, not promised, by
[the bundle-reachability suite](../conventions/bundle-reachability-suite.md)
(`packages/github-actions/__test__/reachability.test.ts`), which walks the
runtime import graph of `src` statically and asserts both that no module
outside the permitted set reaches Azure and that the permitted modules do
reach it. The second assertion exists because an earlier walker stripped
block comments before line comments and reported a module importing Azure
as importing nothing at all — a confinement test that can only pass, never
fail, is worthless, and this one failed silently in the safe direction,
which for a confinement test is the worst direction there is.

## Alternatives rejected

**Two modules (cache, artifact), with the blob store's GitHub-cache
backend routed through the artifact module's transport.** Rejected
because it would force a real dependency edge between two independently
useful protocols merely to keep the "two Azure modules" mental model
intact; the honest edge set is three, and pretending otherwise would make
the reachability suite assert a claim narrower than reality.

**A shared internal Azure adapter used by all three modules.** Rejected
because hoisting the client into `internal/` is exactly the move that
would make the confinement unenforceable — an internal helper importing
Azure gives every module that imports the helper an indirect edge to
Azure, and the reachability suite would have to widen its permitted set to
include the helper's importers, defeating the point.

## Consequences

Every heavy edge here — Azure, `markdown`, `npm`, and through `sbom` the
Sigstore stack — remains a **declared dependency** of the package
regardless of the confinement, so it is installed for every consumer and
a bundler's resolver still walks it. Import-graph confinement is not
resolver-graph absence; only a consumer that actually bundles and
tree-shakes (resting on `"sideEffects": false`, which the suite also
asserts, plus module-per-file build output) sees the module dropped. The
composed runtime layer in `Action.run` excludes the cache, artifact and
blob services for the same reason: folding them in would put Azure in the
bundle of every action that merely sets an output.
