---
"@effected/lockfiles": minor
---

## Breaking Changes

* The yarn grammar is removed and `"yarn"` is no longer a `LockfileFormat`. A yarn lockfile is refused rather than parsed.
* Each manager's own document is now parsed by that manager's package. `PnpmExtension`, the pnpm env-lockfile document and `BunExtension` moved out of this package, to `@effected/pnpm` and `@effected/bun`.
* `@effected/pnpm` and `@effected/bun` are new required peer dependencies. Install both beside this package.
* `@effected/jsonc` and `@effected/yaml` are no longer peer dependencies: nothing in this package imports them, since the manager packages parse their own documents.
* The config-only path decodes the whole env-lockfile preamble, so a malformed preamble now fails validation.
