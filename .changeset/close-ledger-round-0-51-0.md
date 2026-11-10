---
"@effected/ai-plugins": patch
---

## Maintenance

- Closes the `effected-renovate` upgrade-ledger round released in 0.51.0, so the shipped ledger starts empty from that release. A repository older than the new baseline still gets every entry it crossed, fetched from the 0.51.0 release tag.
- Three traps from the round move into the standing table: `effect/package.json` not resolving from the root, `noUndeclaredDependencies` on `@effected/plugin` beside a `schemastore.config.*`, and `TS2883` after a kit package stops importing a dependency in its declarations.
