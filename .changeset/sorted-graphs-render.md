---
"@effected/workspaces": minor
---

## Features

### `DependencyGraph.toMermaid()`

Renders a `DependencyGraph` as a Mermaid `flowchart TD` — drop it into a job summary, an issue, or a design doc. It's total (never fails), and both nodes and edges are emitted in sorted order, so the output is deterministic regardless of manifest key order. Scoped package names (`@acme/app`) appear only inside quoted labels, so they never break Mermaid syntax.

```ts
console.log(graph.toMermaid());
// flowchart TD
//   0["@acme/app"]
//   1["@acme/utils"]
//   0 --> 1
```

## Bug Fixes

`CyclicDependencyError.cycle` now names the packages actually in the cycle — the strongly-connected components — instead of every package Kahn's algorithm had left unprocessed when it stalled, which also included packages merely downstream of the cycle. Applies to both `levels()`/`sort()` and `sortSubset()`. The field's shape (`ReadonlyArray<string>`) is unchanged; only which packages appear in it is corrected.
