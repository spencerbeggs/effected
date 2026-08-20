---
"@effected/lockfiles": patch
---

## Bug Fixes

A pnpm `link:` target that lands inside a workspace package now resolves to that importer, so a workspace using `publishConfig.linkDirectory` no longer reports every workspace edge as unresolved.

pnpm records such a link against the package's publish directory — `link:../bundler/dist/dev/pkg` where `packages/bundler` is the importer — and that directory is a build output, so the edge landed in `ResolvedPackage.unresolvedEdges` and `@effected/workspaces`' `PeerCheck` reported `unverified: ["unresolvedEdge"]` permanently on a workspace `pnpm peers check` calls clean.

* The target resolves to the longest ancestor of it that is an importer path, and only when the recorded specifier starts with `workspace:` — a hand-written `link:` target may be a vendored stub with its own identity, so it stays unnameable rather than being attributed to the importer that encloses it
* The root importer is never the answer, being an ancestor of every path in the workspace
* Snapshot edges are unchanged: a snapshot body records no specifier, so the evidence the rule turns on is not available there
