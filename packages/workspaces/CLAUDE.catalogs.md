# Catalogs and hook replay — @effected/workspaces

Catalog assembly, the release-age gate, `ConfigDependencyHooks` and the importer-version fallback — the reasoning behind the parent's rules.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## Catalog assembly is PM-aware

`WorkspaceCatalogs` picks its inline reader by **file presence**: `pnpm-workspace.yaml` selects the pnpm blocks; its absence selects bun's root `package.json` `workspaces.catalog` / `workspaces.catalogs`. `CatalogSet.fromLockfile` likewise reads whichever extension (pnpm or bun) the parsed lockfile carries.

Both **live** inline readers hard-fail on a malformed catalog block or a default catalog declared twice (top-level `catalog` *and* `catalogs.default` for pnpm; `workspaces.catalog` *and* `workspaces.catalogs.default` for bun) — a silently-empty catalog is the "every dependency looks newly added" bug. They share one validator (`validatedCatalogBlocks`), so they fail typed on exactly the same conditions rather than one hard-failing and the other normalizing to `{}`. The at-ref readers (`CatalogSet.fromWorkspaceYaml`, `bunInlineCatalogs`) are deliberately **tolerant** of the same shapes. The presence probe distinguishes genuine absence from a probe FAILURE: a non-NotFound `PlatformError` from `fs.exists` fails typed rather than collapsing to "absent" and selecting the wrong reader.

`releaseAgeGate()` returns an `Effect<ReleaseAgeGate, CatalogAssemblyFailure>`: inline release-age keys and hook contributions combine **strictest-wins** in the same single memoized assemble pass as the catalogs. Malformed inline values hard-fail as `CatalogAssemblyError(source: "manifest")`. There is deliberately **no** top-level `Workspaces` convenience.

## A hook-injected catalog resolves through the lockfile importers

A `catalog:` specifier injected by a pnpm config-dependency pnpmfile hook (`"effect": "catalog:effect:peers"`) is recorded in **neither** committed source a snapshot reads: the workspace declares no such catalog, and pnpm does not record a **peer-only** catalog in the lockfile's `catalogs:` block. Both sides of a before/after diff then resolved it to the same raw string, so a genuine beta bump produced no row and no changeset (`type-registry-effect`, Actions run 30130459942).

The fix is `internal/importerVersions.ts`: when the catalog set cannot answer a `catalog:` specifier, fall back to the version that ref's own lockfile importer entry recorded. Three things about it are load-bearing:

- **Never replay the hook to fix this.** `WorkspaceSnapshots.at(ref)` reads through `git show` with no checkout and can never execute a past ref's pnpmfile, so `layerWithConfigDependencies` fixes only the worktree side — an asymmetry that manufactures a bogus `from: "catalog:effect:peers"` → `to: "<version>"` row on **every** run. Both lockfiles are committed, which is why this shape was chosen.
- **The join is by dependency NAME, across every dependency field.** pnpm writes a peer into the importer block only when it is also installed, so a `catalog:effect:peers` peer's concrete version lives on that importer's `devDependencies` row. Joining by field, or by matching the recorded specifier, finds nothing.
- **Importer versions are raw and MUST be normalized.** `@effected/lockfiles` stores `ImporterDependency.version` verbatim, peer suffix included (`4.0.0-beta.101(effect@4.0.0-beta.101)(…)`); unstripped, that whole chain lands in a consumer's dependency table as the version. `link:`/`file:` entries are skipped — a filesystem edge is not a version.

## `ConfigDependencyHooks` — opt-in pnpmfile replay

A pnpm config dependency's pnpmfile `updateConfig` hook can mutate catalogs; replaying it executes config-dependency code, so it is gated behind three layers. `layerNoop` returns `{ catalogs: seed, releaseAge: {} }` untouched; `layerLive` dynamically `import()`s each pnpmfile **in process**; `layerSubprocess` replays it in a `node` child process and therefore requires core's `ChildProcessSpawner` in `R`. Composite mapping (on both `WorkspaceCatalogs` and `Workspaces`): `layer` → `layerNoop`, `layerWithConfigDependencies` → `layerLive`, `layerWithConfigDependenciesSubprocess` → `layerSubprocess`.

`inject` returns a `HookInjection { catalogs, releaseAge }` — **one replay, both outputs**. Release-age keys thread last-hook-wins; malformed hook values are tolerantly dropped (`CatalogAssemblyError` stays mechanism-only). A `..` segment in a config-dependency name, or a hook that fails to load or replay, fails typed as a `hooks`-source `CatalogAssemblyError` — never a silent skip.

The pnpmfile is loaded by trying `pnpmfile.mjs` **first** (a pnpm-11-native config dep may carry only `.mjs`) and falling back to `pnpmfile.cjs`; `import()` loads both. The "no pnpmfile" skip is keyed on `import()` raising `ERR_MODULE_NOT_FOUND` **for the candidate file itself** — discriminated by comparing Node's `err.url` against the candidate URL, so an `ERR_MODULE_NOT_FOUND` for a module the pnpmfile *imports* surfaces typed rather than being mistaken for an absent file. There is **no `existsSync` precheck** (it returns false for an existing-but-inaccessible file and would silently skip a real hook); any other load failure surfaces typed.

## `layerSubprocess` exists because a bundler cannot see through a computed import

`layerLive` computes its `import()` target at runtime, and a bundler (rspack) compiles a computed dynamic import into a context module that throws `Cannot find module 'file:///…'` — so `releaseAgeGate()`, the reason an Action opts into hooks at all, was uncallable from any bundled GitHub Action (#280, a silk-update-action dogfood request). `layerSubprocess` moves the computed load out of the bundle graph. Four things are load-bearing:

- **The replay program is a STATIC string constant and the runtime values travel via argv** — `node --input-type=module -e <script> <root> <seedJSON> <...names>`, read back as `process.argv.slice(1)`. Interpolating any runtime value into the script text puts it back in front of the bundler and reinstates the bug.
- **Typed-semantics parity with `layerLive` is the contract**, pinned by an integration test driving both layers against one on-disk fixture: `.mjs`-before-`.cjs`, the `err.url`-equality skip discrimination, the same hook-locator shapes, the same synchronous call, the same tolerant threading, the same `"hooks"`-source error attribution, and the same `..`-segment refusal — validated **before** spawning, so no subprocess ever sees a traversal name. Change one side and change the other.
- **The child's protocol payload is framed by `@effected/commands`' `Run.jsonLine`** against a strict `{ ok: true, config } | { ok: false, name?, message?, stack? }` schema — last non-empty stdout line, parsed regardless of exit code, so a hook's own `console.log` noise is tolerated. The hand-rolled copy of that framing was deleted; do not reintroduce it.
- **Folding and normalization stay in the PARENT.** The child returns only the raw threaded config slice (it cannot import kit code); `configOf` / `configToEntries` / `releaseAgeOf` run here, on the same `@pnpm/catalogs`-derived path `layerLive` uses.

**Related:** [surface](./CLAUDE.surface.md) · [discovery](./CLAUDE.discovery.md) · [snapshots](./CLAUDE.snapshots.md)
