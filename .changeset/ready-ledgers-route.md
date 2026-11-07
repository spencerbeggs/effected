---
"@effected/ai-plugins": minor
---

## Features

* The `effected-renovate` upgrade ledger gains migration entries for this release's breaking and behavioural changes in `@effected/walker`, `@effected/markdown`, `@effected/glob` and `@effected/npm`
* The ledger also gains opt-in adoption entries for the new surfaces in `glob`, `walker`, `markdown`, `npm`, `workspaces`, `lockfiles`, `crypto`, `webhooks`, `github` and `files`, each offered to the user and never applied unasked
* The `effected-packages` skill and construct index now route to those new surfaces, including `Wildcard`, `PosixPath`, `@effected/markdown/stringify`, `Hash.digest`, `LockfileDiff`, `PnpmSettings` and `GitHubUserAuth`

## Bug Fixes

* `effected-renovate` now verifies the resolved Effect version with `pnpm why effect --depth 0`. The previous `node -p` check failed with `Cannot find module` after a good install, from a root that does not declare `effect`
* A new ledger entry corrects the schemastore migration: declare `@effected/plugin` in the manifest of the package that holds `schemastore.config.*`, not only at the root, or Biome's `noUndeclaredDependencies` reports it. Both traps are also listed in the skill's traps reference
