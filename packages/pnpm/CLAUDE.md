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

`src/index.ts` is the only re-exporting module. It exports `PnpmSettings`/`PnpmSettingsError` (the `pnpm config get` view), `ReleaseAgeGate`/`PartialReleaseAgeGate` (`minimumReleaseAge`), `PnpmMatcher` (the `@pnpm/matcher` list grammar), `OverrideKey`/`OverrideKeyError` (the `overrides` selector grammar), `PeerDependencyRules` (the `peerDependencyRules` block; replaces workspaces' former type and `NoPeerDependencyRules`), `PnpmWorkspaceFile`/`PnpmWorkspaceFileError` (the `pnpm-workspace.yaml` editor over `@effected/yaml`: `parseResult`/`parse`, `writeResult`/`write`, `renderResult`/`render`, `inferStyle`, `canonicalize`; `source` is the only field and `value` a memoised getter; fixtures in `__test__/fixtures/workspace-style/`), and the native `pnpm-lock.yaml` documents: `PnpmLockDocument`, `PnpmEnvDocument` and `PnpmExtension`. They are pinned by `__test__/entrypoints.test.ts`. The document parsers fail `@effected/npm`'s `LockfileDocumentError`. `src/internal/stream.ts` is the one place a pnpm YAML stream is split into preamble and lockfile, and `src/internal/version.ts` holds the `lockfileVersion` 9 gate. The `PnpmEnvLockfile` readers stay in `@effected/lockfiles` (ruled: their errors are lockfiles' contract). `__test__/fixtures/lockfiles/` holds copies of lockfiles' fixtures with a provenance README. The `catalog:`/`workspace:` contracts are not here: they stay in `@effected/npm` as shared (`okf/decisions/catalog-and-workspace-protocol-owner.md`).
Outside `index.ts`, modules import explicitly — no barrels.

The settings catalog ships from the `@effected/pnpm/settings` subpath
(`src/settings.ts`: the `PnpmSettingsCatalog` facade with `entries` and `read`, `PnpmSetting`; the per-area entries live in `src/settings/internal/`) and
the root must never reach it — `entrypoints.test.ts` walks the source graph to
pin that, over source and the built `index.js`, counting any `@effected/pnpm/*` self-import. The subpath imports root types through `@effected/pnpm` itself;
`effected.toml` keeps that import external in the declarations with an
`ae-forgotten-export` suppression scoped to `settings.d.ts`, made safe by
`__test__/settings/declarations.test.ts` over the built declarations.

The catalog is held to `__test__/fixtures/pnpm-12.20.0-settings.json`, which
`scripts/extract-pnpm-settings.mts` extracts from `.repos/pnpm` (method in the
fixture README; `node scripts/extract-pnpm-settings.mts --check` from this
directory reports staleness). After re-pinning `.repos/pnpm`, regenerate it and
reconcile `src/settings/catalog/*.ts` with what the coverage tests report. A
catalog entry carries facts about pnpm only — never strictness, merge strategy
or enforcement. Scalar coercions live once in `src/internal/coerce.ts`, shared
by `PnpmSettings` and the catalog codecs.
