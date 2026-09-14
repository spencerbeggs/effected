---
type: Convention
title: Peer-dependency discipline
description: Every package declares its complete peer closure; libraries keep effect as a peer; internal @effected edges float on workspace:^ so consumer trees dedupe onto one copy.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - compat
  - release
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 459f227534a2bf913070d91c4684d3dd87f19fad8ebeffe623f60b1b0a6e306b
---

# Peer-dependency discipline

Every package must declare its complete peer closure. A declared
`@effect/*` dependency whose own non-optional peers are left undeclared
is a defect — unfulfilled transitive peers escape to the consumer's
importer, where pnpm's `autoInstallPeers` can bind an incompatible
`effect` version (historically a v4 beta bound into a v3-wanting
package, and on at least one prerelease advance, two different v4
prereleases glued into a single decode pipeline). Because every
published package's `effect` peer is an exact pin, an unsatisfiable one
glues in anyway with no install-time error and surfaces later as a
runtime failure far from its cause — see [an unsatisfiable exact effect
peer installs clean and fails somewhere
else](../gotchas/exact-effect-peer-silently-satisfiable.md).

- Libraries keep `effect` as a peer dependency, never a regular one.
- Tools and applications consuming libraries declare the full stack as
  regular dependencies instead of peers, since nothing downstream needs
  to share their copy.

`pnpm peers check` has one known-issue slot and its occupant rotates,
always somewhere in the toolchain graph rather than in this workspace,
clearing when the offending tool republishes against the current
`effect` prerelease — see [the expected `pnpm peers check`
occupant](../gotchas/expected-peers-check-occupant.md) for who currently
holds it. Do not silence the occupant, and do not
read its presence as license to tolerate a second one: any other warning
from `pnpm peers check` is a genuine closure defect to fix upstream.

## Verified workspace configuration

The workspace-level settings that keep the whole tree — this workspace
and the build toolchain alike — on a single `effect` copy live in
`pnpm-workspace.yaml` and the root `package.json`; read those directly
for exact values rather than trusting a paraphrase, since they change
with each catalog advance.

- Every published tool in the dependency chain declares its complete
  `@effect/*` peer closure as regular dependencies, so no transitive peer
  escapes to a consumer's importer where `autoInstallPeers` could bind an
  incompatible `effect`. A tool that does not is a defect to fix
  upstream, not to work around in this repo.
- `pnpm-workspace.yaml` sets `autoInstallPeers: true`,[^pnpm-workspace]
  so the tool peers of the root devDependencies are auto-installed rather
  than declared explicitly. It pins neither `dedupeDirectDeps` nor
  `dedupePeerDependents` — pnpm's defaults apply — and there is no
  `.npmrc`.
- Every package typechecks with `tsc --noEmit` against
  `typescript: catalog:build`; `@effect/tsgo` is not a package
  dependency.
- The root `package.json` carries only the two toolchain devDependencies
  (silk and the vitest-agent plugin); everything else is an
  auto-installed peer. `@savvy-web/bundler` is a `devDependency` of every
  package that builds — it is what `savvy.build.ts` imports — and must
  never be a `dependency`, or the publishable manifest ships a build tool
  at runtime.

The pnpm resolver bug that once forced workarounds here — a v4 `effect`
peer binding into v3-wanting importers — is fixed upstream in
pnpm >= 11.12.0.

## Cross-@effected dependencies

Every internal `@effected/*` edge — peer and regular dependency alike —
uses `workspace:^`. The one exception is the paired `devDependency` that
satisfies an auto-installed peer, which stays `workspace:*` and is never
published. Patch-floating is the point: a sibling patch flows into an
existing release without forcing a coordinated re-release, while a minor
bump still needs one. Whether an edge is a peer or a regular dependency
is decided per edge at design time — that choice is about the
shared-instance contract, not the version range. Floating the regular
edges too, not only the peers, lets a consumer's paths dedupe onto one
sibling copy, which matters where an integrated package surfaces a
sibling's types across its own public API.

`^` and `~` resolve identically for every package in this kit today. At
`0.x.y` with a non-zero minor — which is every package here — the
caret's "don't change the left-most non-zero digit" rule and the tilde's
"patches only" rule both mean `>=x.y.z <x.(y+1).0`, so the operator
choice changes no resolution today, and it cannot be what fixes a
peer-resolution problem — a diagnosis that credits the operator is
looking at the wrong cause. (The one `0.x` shape where they differ is
`0.0.z`, where `~` is the looser of the two; nothing in this kit sits at
`0.0.z`.)

The decision it actually makes is the `1.0.0` one. At `1.x`, `^1.2.3`
admits every later `1.x` and `~1.2.3` admits only patches. `^` is correct
there for a reason specific to this kit rather than general taste: the
goal above is that a consumer's paths dedupe onto one sibling copy, and
range width is what makes that possible. Two consumers requiring
`^1.2.0` and `^1.5.0` both resolve to a single `1.5.x`; under `~1.2.0`
and `~1.5.0` they cannot, and the tree ends up with two copies of one
package. In this kit, two resolved copies are two distinct
`Context.Service` tags, which surfaces as a service reading unprovided in
a graph that visibly provides it — not as a version error. The wider
range is the safer one here, which inverts the usual intuition toward
tighter ranges being safer.

The dependency graph among `@effected/*` packages must stay **acyclic**.
CI publishes whatever set of pending changesets it finds in one run, so
there is no strict dependency-ordered publish step for a cycle to break —
a cycle is not caught by a failing release, it simply becomes permanent.
The kit can carry as many small packages as the seams justify; what it
cannot carry is a back-edge. In practice every edge runs from boundary
toward pure, or from pure toward more-pure, and an edge that wants to run
the other way is a sign the shared thing belongs in a third package.

The consumer-side half of why internal edges float on `workspace:^` — the
requirement that the same one-copy property this kit maintains for
itself also holds in a consumer's own tree — is covered in
[one resolved effect copy](one-resolved-effect-copy.md).

## A CommonJS dependency's named exports are detected per-symbol, not all-or-nothing

A dependency vendored or consumed as CommonJS does not uniformly support
or reject named imports — Node's `cjs-module-lexer` detects some of its
named exports and misses others in the same module, so one named import
can work while its neighbour throws only at runtime. See [Node detects
only some of a CommonJS dependency's named
exports](../gotchas/cjs-named-import-detection-is-partial.md) for the
measured example and the testing rule it implies.

[^pnpm-workspace]: `pnpm-workspace.yaml:6` — `autoInstallPeers: true`.
