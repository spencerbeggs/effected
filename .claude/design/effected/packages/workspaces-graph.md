---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - workspaces.md
  - workspaces-discovery.md
  - ../effect-standards.md
---

# @effected/workspaces — the dependency graph

## Overview

`DependencyGraph` is [@effected/workspaces](workspaces.md)' pure value class over the [discovered](workspaces-discovery.md) package list: the edge index, cycle detection, topological levels and the Mermaid rendering. See `src/DependencyGraph.ts`.

It is a value class with lazily-built private edge indexes: total sync accessors, and fallible boundaries for the queries that can fail. **Cycle detection is iterative**, using an explicit stack rather than a recursive DFS, so there is no stack-overflow surface on a deep chain. Kahn's algorithm gives deterministic, lexicographically-sorted level output, made linear by the reverse-edge index the class already builds.

Sorting is methods on this class rather than a service, and there is no request-resolver cache — there is no batching win on a single-key resolver and nothing the memoized discovery init has not already deduplicated.

## Core's Graph is adopted at two call sites, not as the substrate

Core ships a root-level `Graph` module and this package uses it — **for two derived answers only, over transient graphs built on demand.** The edge index, `hasCycle`, Kahn's algorithm, the `levels` / `sort` / `sortSubset` machinery, the public name-keyed API and the Schema contract (whose only field is `packages`) are all unchanged. There is no new dependency; `Graph` comes from `effect` itself.

**The substrate swap was evaluated and rejected.** It would replace the trivially-correct part — building two maps out of manifests — while keeping every part that is actually hard, and it would add a permanent name↔`NodeIndex` translation layer beneath an API that consumers address by package name. It would also widen this package's dependence on an exact-pinned prerelease surface for no stability gain. **Transient construction at the two call sites confines that exposure to code that is already failing or already rendering**, which is the whole shape of the adoption.

**`levels` stays hand-rolled, and that is a finding rather than a preference.** Core's `topo` cannot produce the parallel-wave boundaries `levels` exists to give: its walker exposes no level data, and `TopoConfig.initials` only *prioritizes* zero-in-degree nodes rather than fencing a wave. Settled against the vendored source and re-confirmed at the pinned Effect release in the kit-wide core-primitive audit, so it does not need re-deriving. That re-check added two gaps to the same verdict, both of which outlive `levels`: core's traversals **throw** `GraphError` rather than failing typed — so a cycle would arrive as a *defect* carrying a message instead of the `CyclicDependencyError` payload that names the offending packages — and `affectedBy`'s reverse reachability has no core equivalent at all, so the reverse-edge index stays regardless. The throw is precisely why the two adopted call sites are the ones they are: `stronglyConnectedComponents` and `toMermaid` do not throw on any graph this class can hold. Both facts generalize past this package and are recorded as such in [effect-standards.md](../effect-standards.md#core-owning-a-primitive-is-not-the-same-as-cores-primitive-fitting).

Both transient graphs materialize through one helper that adds nodes in sorted-name order and each node's edges in sorted-target order, so `NodeIndex` *i* is always the *i*th sorted name and **everything derived is deterministic regardless of manifest key order.**

## The cycle payload names the cycle, not the stall

`CyclicDependencyError.cycle` is **the sorted union of every strongly connected component with more than one member**, from core's `Graph.stronglyConnectedComponents` — never Kahn's stalled set, which is a different thing: the stall holds every node that never cleared, *including packages merely downstream of a cycle*, so a payload built from it names blameless packages and points a consumer reading it as "break one of these edges" at edges that break nothing. A non-empty stall still signals *that* a cycle exists — it is just not the answer to *which*. Both failure paths, `levels` and `sortSubset`, carry the same payload, and the error's schema field is unchanged. Self-edges are dropped at index time, so a one-member component is never cyclic here.

The discrimination is mutation-pinned on both failure paths: a downstream dependent must be excluded, and two independent cycles must yield the union of both. That is the one edge separating the SCC answer from Kahn's stalled set, which agree on every graph where nothing hangs off the cycle.

## toMermaid

A **total** method rendering the graph as a Mermaid `flowchart TD` through core's `Graph.toMermaid`. Node IDs are the numeric indexes and package names appear only inside quoted labels, so a scoped name never breaks Mermaid syntax — the property to keep if this is ever re-implemented.
