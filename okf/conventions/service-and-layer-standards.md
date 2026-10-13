---
type: Convention
title: Services and layers standards
description: Services as Context.Service classes, layers exported beside them, composition rules, and the swappable-contract discipline that keeps a default from becoming ambient policy.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-context
    resource: ../../.repos/effect/packages/effect/src/Context.ts
  - id: workspaces-publishability
    resource: ../../packages/workspaces/src/Publishability.ts
  - id: workspaces-versioning
    resource: ../../packages/workspaces/src/VersioningStrategy.ts
  - id: github-app
    resource: ../../packages/github/src/GitHubApp.ts
  - id: workspaces-src
    resource: ../../packages/workspaces/src/Workspaces.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7cb3ef41db1128c9
---

# Services and layers standards

- Services are classes extending `Context.Service` — identifier and shape
  live in one place, and `yield* ServiceName` works
  naturally.[^effect-context] Interfaces stay small and focused.
- Layers are exported alongside their service in the same module file
  (see [module-per-concept layout](module-per-concept-layout.md)).
  `Layer.succeed` for pure prebuilt implementations; `Layer.effect` for
  effectful or scoped construction; never hide effectful initialization
  inside `Layer.succeed`.
- Compose subsystem wiring locally, application wiring at the edge:
  `Layer.mergeAll` (side by side), `Layer.provide` (plug in dependencies,
  expose the target), `Layer.provideMerge` (expose both).
- Provide layers at boundaries only — app entry, subsystem entry, test
  boundary. Business logic requires services; it never calls
  `Effect.provide` locally.
- Layers are memoized by reference: bind layers to constants and avoid
  layer-producing functions unless the layer is genuinely parameterized.
- No redundant accessor wrapper functions per service method.
- Libraries in this repo export services and layers; consumers (apps)
  compose them and provide platform implementations at the edge.

## A swappable contract gets no ambient default inside a composite layer

The requirement surfaces in the consuming operation's `R` instead, and
the composer provides it. That is both the safe choice — a default baked
into a composite reverts to policy nobody chose the moment merge order
changes, silently — and the ergonomic one, since consumers that never
reach the operation never have to supply the policy.

`@effected/workspaces`'s `PublishabilityDetector` is the exemplar: the
package's composite layers neither provide nor require a detector — their
`R` is unchanged, because nothing inside them consumes
one[^workspaces-publishability] — and the requirement surfaces only in
the consuming operation's `R`, `VersioningStrategy.detect`.[^workspaces-versioning]
A program names `PublishabilityDetector.layerNpm`, or its own
implementation, exactly where its `R` says so, and a program that never
asks a publishability question never supplies a policy at all.

## Every shipped implementation of a swappable contract is exported as a value too

A consumer composing *around* the default cannot use a bare layer without
re-entering the tag it is replacing, so the implementation has to be
callable directly as well. `Publishability.npm`
(`PublishabilityDetectorShape`) is exported beside
`Publishability.layerNpm` for exactly this reason.[^workspaces-publishability]

## A layer-family static belongs to the module owning the dependency it needs

Never to the module declaring the service — this is the bundle-confinement
corollary of [no barrel re-exports](no-barrel-re-exports.md). A layer
variant homed on the service's own module makes that variant's dependency
reachable from every importer of the service, even one that never wants
that variant. Two precedents:

- `GitHubApp.clientLayer` — the App-authenticated `GitHubClient` layer,
  homed with the JWT engine it needs rather than on the generic
  `GitHubClient` service.[^github-app]
- `Workspaces.localExecLayer` — implementing `@effected/commands`'s
  `LocalExec` contract, homed with the discovery graph it needs rather
  than on `commands`'s own module.[^workspaces-src]

## Resolve a dependency once at construction when it is stable; read it per call when varying it is the point

The wrong choice is silent in both directions, and the per-call side is
the one that bites in practice: construction-time resolution left a
scoped `Repo.provide` override compiling and doing nothing in the
`github` port, a defect caught by a test rather than by the compiler.

[^effect-context]: `.repos/effect/packages/effect/src/Context.ts` —
    `Context.Service` and the class-style `Context.Service<Self,
    Shape>()("Id")` form.
[^workspaces-publishability]: `packages/workspaces/src/Publishability.ts`
    — `PublishabilityDetector.npm` and `PublishabilityDetector.layerNpm`
    exported side by side.
[^workspaces-versioning]: `packages/workspaces/src/VersioningStrategy.ts`
    — `VersioningStrategy.detect` is where `PublishabilityDetector`
    surfaces in `R`.
[^github-app]: `packages/github/src/GitHubApp.ts` — `static readonly
    clientLayer`, homed with the JWT engine.
[^workspaces-src]: `packages/workspaces/src/Workspaces.ts` — `static
    readonly localExecLayer`, homed with the discovery graph.
