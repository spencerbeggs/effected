# @effected/lockfiles

Pure lockfile parsing for the four package-manager formats — bun (`bun.lock` JSONC), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile` model, plus pure integrity checking of that model against workspace manifests. Extracted from `workspaces-effect` per the workspaces review; the `LockfileReader` service (root find, PM detect, file IO, dispatch) stays in the future `@effected/workspaces`, which consumes this package.

**Design doc:** `@../../.claude/design/effected/packages/lockfiles.md` — load when changing the model, the parse pipeline or either seam repair.

## Tier

**Pure.** No services, no layers, no IO, no `R` anywhere. Peers: `effect` plus three pure-to-pure `workspace:*` edges — `@effected/jsonc` (bun), `@effected/yaml` (pnpm, yarn) and `@effected/semver` (integrity ranges) — each mirrored in devDependencies. Zero external runtime dependencies; the text-parsing engines arrive through the sibling packages, so nothing is vendored here.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `Lockfile`, `LockfileParseError` — from `src/Lockfile.ts`
- `LockfileFormat`, `filenameFor`, `fromFilename` — from `src/LockfileFormat.ts`
- `LockfileIntegrity`, `WorkspaceManifest` — from `src/LockfileIntegrity.ts`
- `ResolvedPackage` — from `src/ResolvedPackage.ts`
- `WorkspaceDependency`, `DependencyType` — from `src/WorkspaceDependency.ts`
- `PnpmExtension`, `PnpmCatalogs` (type) — from `src/PnpmExtension.ts`
- `BunExtension` — from `src/BunExtension.ts`

`Lockfile.parse(content, { format })` is the package's **only fallible boundary** (one `Effect.fn` span, no logging, no metrics). Everything else is total: `withImporterNames`, `packagesNamed` (lazy `#private` name index), `workspacePackages`, `LockfileIntegrity.compare`.

Note: the integrity check is `LockfileIntegrity.compare`, not `.check` — every v4 `Schema.Class` already carries a `static check(...checks)` for attaching schema checks, so the design doc's original name is unavailable.

## The two seam repairs

1. **pnpm name resolution is an explicit second stage.** `Lockfile.parse` emits pnpm workspace packages named by importer *path* with version `"0.0.0"`; `lockfile.withImporterNames(map)` — total, pure — rewrites names and both dependency-edge ends. Manifest IO that builds the map belongs to the consumer.
2. **Integrity checking is total and pure.** `LockfileIntegrity.compare(lockfile, manifests)` takes `WorkspaceManifest` values (name + four optional dep records) and returns the report infallibly. v3's `LockfileIntegrityError` was deleted, not ported. `workspace:`/`link:`/`file:` specifiers and unparseable semver rows are skipped by design.

## Internal layout

Per-format raw schemas and transforms are **private** in `src/internal/{bun,npm,pnpm,yarn,shared}.ts`. Internals import only the leaf model modules, never `Lockfile.ts` (`noImportCycles`); they fail with a raw `ParseFailure = { stage, cause }` record that `Lockfile.parse` materializes into `LockfileParseError` with the format attached.

## Hardening invariants

- Malformed input **always** exits typed (`stage: "syntax"` for text-level failures, `"validation"` for shape failures) — never a defect. Nesting bombs surface the delegated engines' typed failures.
- Key-bearing intermediates are `Map`/`Set`; records are built with `Object.fromEntries` (own-property semantics — a `__proto__` key neither pollutes nor drops).
- `name@version` splitters and yarn descriptor extractors are total: malformed keys are *skipped*, and rows that would produce empty names are skipped rather than thrown on (`Schema.NonEmptyString` construction would otherwise die as a defect).
- Yarn support is **Berry only**: classic v1 content fails typed at validation (its entry bodies YAML-parse as scalars); it never mis-normalizes.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`. Four families: per-format fixture tests (`Lockfile.test.ts` over `__test__/fixtures/{pnpm,npm,yarn,bun}/v*`), seam-repair tests (`withImporterNames` in `Lockfile.test.ts`, `LockfileIntegrity.test.ts`), the hostility suite (`hostile.test.ts`) and codec round-trips (`roundtrip.property.test.ts`, `it.effect.prop` over `Schema.toArbitrary`).

```bash
pnpm vitest run packages/lockfiles          # from the repo root
pnpm build --filter @effected/lockfiles     # from the repo root
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
