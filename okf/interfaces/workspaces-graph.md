---
type: Interface
title: "@effected/workspaces dependency graph"
description: The pure DependencyGraph value class over the discovered package list — the edge index, cycle detection, topological levels, and Mermaid rendering.
status: stable
kind: api
resource: ../../packages/workspaces/src/DependencyGraph.ts
tags:
  - architecture
sources:
  - id: dependency-graph-ts
    resource: ../../packages/workspaces/src/DependencyGraph.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: a675cd9d0ab8017ed30251661b95a771ad50d6525e2be375a0ceb03a44bf2fb8
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:46.601Z
---

# @effected/workspaces dependency graph

`DependencyGraph` is a pure value class over
[the discovered package list](workspaces-discovery.md): the edge index,
cycle detection, topological levels, and Mermaid rendering.[^dependency-graph-ts]
It is not a service — sorting is methods on this class rather than a
separate service, and there is no request-resolver cache, because there is
no batching win on a single-key resolver and nothing the memoized discovery
init has not already deduplicated.

It has lazily-built private edge indexes exposed through total sync
accessors, and fallible boundaries only for the queries that can fail.
Cycle detection is iterative, using an explicit stack rather than a
recursive DFS, so there is no stack-overflow surface on a deep chain.
Kahn's algorithm gives deterministic, lexicographically-sorted level output,
made linear by the reverse-edge index the class already builds.

## Core's Graph is adopted at two call sites, not as the substrate

Core (`effect`) ships a root-level `Graph` module, and this class uses it —
for two derived answers only, over transient graphs built on demand: the
strongly-connected-components computation behind cycle detection, and
`toMermaid`. The edge index, `hasCycle`, Kahn's algorithm, the `levels` /
`sort` / `sortSubset` machinery, the public name-keyed API, and the Schema
contract are all unchanged and hand-rolled. There is no new dependency —
`Graph` comes from `effect` itself, which this package already depends on
as a peer.

Replacing the substrate entirely was evaluated and rejected: it would
replace the trivially-correct part (building two maps out of manifests)
while keeping every part that is actually hard, add a permanent
name-to-`NodeIndex` translation layer beneath an API that consumers address
by package name, and widen this package's dependence on an exact-pinned
prerelease surface for no stability gain. Transient construction at the two
call sites confines that exposure to code that is already failing or
already rendering.

`levels` stays hand-rolled: core's `topo` traversal cannot produce the
parallel-wave boundaries `levels` exists to give, because its walker exposes
no level data and `TopoConfig.initials` only prioritizes zero-in-degree
nodes rather than fencing a wave. Two further gaps rule out wider adoption:
core's traversals throw a `GraphError` rather than failing typed, so a
cycle would arrive as a defect carrying a message instead of the
`CyclicDependencyError` payload this class's callers expect, and
`affectedBy`'s reverse reachability has no core equivalent at all, so the
reverse-edge index stays regardless. The throw is precisely why the two
adopted call sites are the ones they are — `stronglyConnectedComponents`
and `toMermaid` do not throw on any graph this class can hold.

Both transient graphs materialize through one shared helper that adds nodes
in sorted-name order and each node's edges in sorted-target order, so
`NodeIndex` *i* is always the *i*th sorted name and everything derived is
deterministic regardless of manifest key order.

## The cycle payload names the cycle, not the stall

`CyclicDependencyError.cycle` is the sorted union of every strongly
connected component with more than one member, taken from core's
`Graph.stronglyConnectedComponents` — never Kahn's stalled set, which is a
different thing. The stall holds every node that never cleared, including
packages merely downstream of a cycle, so a payload built from it would name
blameless packages and point a consumer reading it as "break one of these
edges" at edges that break nothing. A non-empty stall still signals that a
cycle exists; it is just not the answer to which one. Both failure paths,
`levels` and `sortSubset`, carry the same payload, and self-edges are
dropped at index time, so a one-member component is never cyclic here.

## toMermaid

A total method rendering the graph as a Mermaid `flowchart TD` through
core's `Graph.toMermaid`. Node IDs are the numeric indexes, and package
names appear only inside quoted labels, so a scoped package name never
breaks Mermaid syntax.

[^dependency-graph-ts]: `packages/workspaces/src/DependencyGraph.ts` —
    `DependencyGraph` and `CyclicDependencyError`.
