# @effected/pnpm

Everything pnpm owns alone: its settings catalog, versioning block, overrides grammar, workspace file editor and lockfile document, over the npm vocabulary it shares.

**Pure tier at the root:** peer-depends on `effect`, depends on `@effected/npm`, no IO, `"sideEffects": false`.
Owner's rule: a concept that is one manager's alone lives in that manager's
package; a concept shared by several lives in `@effected/npm`. Dependency
direction: npm <- pnpm/bun <- lockfiles <- workspaces; this package never
depends on `lockfiles` or `workspaces`.

**Design doc:** `@./okf/modules/pnpm.md` — load when changing the public API or
moving a module in.

## Public surface

`src/index.ts` is the only re-exporting module and exports nothing yet.
Outside `index.ts`, modules import explicitly — no barrels.

The settings catalog ships from the `@effected/pnpm/settings` subpath and the
root must never reach it.
