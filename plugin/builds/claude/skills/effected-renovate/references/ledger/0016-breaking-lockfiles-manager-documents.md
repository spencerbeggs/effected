---
id: "0016"
title: "@effected/lockfiles: yarn lockfiles are refused, the native document schemas moved to @effected/pnpm and @effected/bun, and both are required peers"
kind: breaking
shows: typed
applies:
  "@effected/lockfiles": ">=0.26.0"
detect: ["PnpmExtension", "BunExtension", "PnpmCatalogs", "LockfileFormat", "\"@effected/lockfiles\""]
changesets: ["lockfiles-manager-documents"]
---

Act on each hit:

1. **Install the new peers.** Where the search matched `"@effected/lockfiles"` in a manifest, add `@effected/pnpm` and `@effected/bun` beside it (`catalog:effected`); both are required peers. `@effected/jsonc` and `@effected/yaml` are no longer its peers: keep them only if your own code imports them.
2. **The native document schemas moved.** Import `PnpmExtension` and `PnpmCatalogs` from `@effected/pnpm` and `BunExtension` from `@effected/bun`. `Lockfile.extension` carries the same shapes.
3. **Yarn is gone.** `"yarn"` is no longer a `LockfileFormat`, and a yarn lockfile is refused rather than parsed. Remove any yarn branch; the compiler flags each.
4. **A malformed env-lockfile preamble now fails.** The config-only path decodes the whole preamble document of a `pnpm-lock.yaml`. A test fixture with a hand-trimmed preamble may need the full document.

Check each name against the installed `.d.ts`, then run the typecheck and tests.
