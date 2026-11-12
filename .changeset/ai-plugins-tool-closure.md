---
"@effected/ai-plugins": patch
---

## Documentation

- The `design-patterns` skill teaches the carrier closure: a tool pins every kit dependency of its packages exactly, while libraries keep carets and peers, with what pinning does not seal and the breaking-floor rule for library releases.
- The `effected-renovate` skill's step 3 explains when two versions of a kit package are correct, and bridges a tool whose caret ranges let a kit peer cross release lines with parent-scoped overrides; step 7 offers exact pins for the repository's own tools, and ledger entry 0011 records the kit tool's change.
- The `effected-renovate` skill ships `stale-edges.mjs`, which reads a lockfile, lists each kit package resolved at two versions and the edges that pull the stale copy, and prints the parent-scoped override line for each tool edge (exit 2 when a split exists).
- The `effected-packages` construct index lists `BreakingFloor` and `FloorCause`.
