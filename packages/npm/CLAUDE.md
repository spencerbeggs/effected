# @effected/npm

Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers.

**For full design rationale and deferred decisions:**
→ `@../../.claude/design/effected/packages/npm.md`

Load when changing contract shapes, adding a resident concept, or reconciling against a real resolver.

## What this is

An **internal package with no source repo** — not migrated from a `*-effect` repo. It was extracted from the `@effected/package-json` port to hold the dependency-resolution contracts that package-json *defines but cannot implement*: resolving a specifier needs workspace and catalog context a package.json-document library has no access to. Contract here, implementation elsewhere.

**Pure tier.** Peer-depends on `effect` only. Zero runtime deps, no IO. Defining a contract runs no effect; the default layers are `Layer.succeed` over functions returning `Option.none()`. Re-check the tier before adding any dependency.

## Exported surface

Exactly four exports from `src/index.ts` — deliberately only what package-json's port needed:

- `CatalogResolver` (`src/CatalogResolver.ts`) — `Context.Service`. `rangeOf(packageName, catalog: Option<string>)` returns the configured range; `Option.none()` for `catalog` selects the default catalog. Ships `CatalogResolver.noop`.
- `WorkspaceResolver` (`src/WorkspaceResolver.ts`) — `Context.Service`. `versionOf(packageName)` returns the concrete version, range modifier stripped. Ships `WorkspaceResolver.noop`.
- `DependencyResolutionError` (`src/WorkspaceResolver.ts`) — `Schema.TaggedErrorClass` with `specifier: Schema.String` and `cause: Schema.Defect()`. Both resolvers raise it.
- `Default` (`src/index.ts`) — `Layer.mergeAll` of both `noop` layers.

Today's only consumer is `@effected/package-json` (`Package.resolve`). Arrows point *at* this package; no outbound workspace edges.

## Invariants

- **An unmatched specifier is `Option.none()`, not an error.** `DependencyResolutionError` is reserved for failure of the resolution *mechanism* (e.g. an unreadable catalog file). Do not blur this.
- **`cause` stays structured.** Never fold it into a string.
- **`Schema.Defect` must be called** — `Schema.Defect()`. The bare value throws at construction.
- **Layers bind to consts, never getters** — a getter mints a fresh layer per access and defeats memoization.
- **`DependencyResolutionError` lives in `WorkspaceResolver.ts`**; `CatalogResolver.ts` type-imports it. That keeps the single runtime edge `CatalogResolver → WorkspaceResolver` and satisfies `noImportCycles`, so `Default` lives in `index.ts`, the cycle-free home.
- Only `src/index.ts` re-exports. No barrel files.

## How it grows

The surface expands when `@effected/workspaces` and `@effected/lockfiles` land. `@effected/workspaces` will implement `CatalogResolver` and carries the richer machinery (a `CatalogSet`, a live resolver); reconciliation is decided *there*, with the real implementer in hand.

`DependencySpecifier` and `PackageName` stay in `@effected/package-json` until a second consumer materializes. Do not pre-claim the pnpm `catalogs:` record shape — that routes to `@effected/lockfiles`.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`. Provide layers via top-level `layer(...)` grouping, not per-test `Effect.provide`. Each contract has a **stub-implementation layer** test proving it is implementable — the pattern real consumers follow. Stubs build `Option` results with `Option.fromUndefinedOr`; `Option.fromNullable` is gone in v4. Currently 11 tests across 2 files.

```bash
pnpm vitest run packages/npm          # 11 tests
pnpm build --filter @effected/npm     # dev + prod
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.

`savvy.build.ts` **does** suppress `ae-forgotten-export` for the `_base` pattern: all three classes are factory-backed (two `Context.Service`, one `Schema.TaggedErrorClass`), written inline per house policy. A clean `dist/prod/issues.json` has empty `warnings`/`errors` and **three** `suppressed` entries (`CatalogResolver_base`, `WorkspaceResolver_base`, `DependencyResolutionError_base`) — `suppressed: 0` in the *prod* gate means the build did not run properly. `dist/dev/issues.json` legitimately has `suppressed: []`; the dev target does not run API Extractor.
