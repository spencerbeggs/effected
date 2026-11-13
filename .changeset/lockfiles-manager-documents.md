---
"@effected/lockfiles": minor
---

## Breaking Changes

* The yarn grammar is removed and `"yarn"` is no longer a `LockfileFormat`. A yarn lockfile is refused rather than parsed.
* Each manager's own document is now parsed by that manager's package. `PnpmExtension`, the pnpm env-lockfile document and `BunExtension` moved out of this package, to `@effected/pnpm` and `@effected/bun`, and this package depends on both.
* The config-only path decodes the whole env-lockfile preamble, so a malformed preamble now fails validation.
