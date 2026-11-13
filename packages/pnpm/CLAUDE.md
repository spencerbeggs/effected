# @effected/pnpm

Everything pnpm owns alone: its settings catalog, versioning block, overrides grammar, workspace file editor and lockfile document, over the npm vocabulary it shares.

**Boundary tier at the root:** peer-depends on `effect` and `@effected/semver` (closing `@effected/npm`'s peer), depends on `@effected/npm`, `@effected/glob`, `@effected/walker` and `@effected/yaml`; the only IO is `PnpmSettings.load`, through core `FileSystem`/`Path` in `R`, no `node:` import; `"sideEffects": false`.
Owner's rule: a concept that is one manager's alone lives in that manager's
package; a concept shared by several lives in `@effected/npm`. Dependency
direction: npm <- pnpm/bun <- lockfiles <- workspaces; this package never
depends on `lockfiles` or `workspaces`.

**Design doc:** `@./okf/modules/pnpm.md` — load when changing the public API or
moving a module in.

## Testing

Tests run on core's `Path.layer` + `@effected/memfs`; `__test__/fixtures.ts` builds the platform layer and its fault handlers.

## Public surface

`src/index.ts` is the only re-exporting module. It exports `PnpmSettings`/`PnpmSettingsError` (the `pnpm config get` view), `ReleaseAgeGate`/`PartialReleaseAgeGate` (`minimumReleaseAge`), `PnpmMatcher` (the `@pnpm/matcher` list grammar), and the native `pnpm-lock.yaml` documents: `PnpmLockDocument`, `PnpmEnvDocument` and `PnpmExtension`. They are pinned by `__test__/entrypoints.test.ts`. The document parsers fail `@effected/npm`'s `LockfileDocumentError`. `src/internal/stream.ts` is the one place a pnpm YAML stream is split into preamble and lockfile, and `src/internal/version.ts` holds the `lockfileVersion` 9 gate. The `PnpmEnvLockfile` readers stay in `@effected/lockfiles` (ruled: their errors are lockfiles' contract). `__test__/fixtures/lockfiles/` holds copies of lockfiles' fixtures with a provenance README. The `catalog:`/`workspace:` contracts are not here: they stay in `@effected/npm` as shared (`okf/decisions/catalog-and-workspace-protocol-owner.md`).
Outside `index.ts`, modules import explicitly — no barrels.

The settings catalog ships from the `@effected/pnpm/settings` subpath and the
root must never reach it.
