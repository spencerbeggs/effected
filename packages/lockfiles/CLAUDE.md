# @effected/lockfiles

Pure lockfile parsing for the four package-manager formats — bun (`bun.lock` JSONC), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile` model, plus pure integrity checking of that model against workspace manifests. Extracted from `workspaces-effect` per the workspaces review; the `LockfileReader` service (root find, PM detect, file IO, dispatch) stays in the future `@effected/workspaces`, which consumes this package.

**Design doc:** `@../../.claude/design/effected/packages/lockfiles.md` — load when changing the model, the parse pipeline or either seam repair.

## Tier

**Pure.** No services, no layers, no IO, no `R` anywhere. Peers: `effect` plus three pure-to-pure `workspace:*` edges — `@effected/jsonc` (bun), `@effected/yaml` (pnpm, yarn) and `@effected/semver` (integrity ranges) — each mirrored in devDependencies. Zero external runtime dependencies; the text-parsing engines arrive through the sibling packages, so nothing is vendored here.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `Lockfile`, `LockfileParseError`, `LockfileFramingError` — from `src/Lockfile.ts`
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

## Document framing (a lockfile is a YAML *stream*)

pnpm 11 writes `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies`: a config-dependencies ("env") preamble, then the lockfile. This repo's own lockfile is that shape. Both documents declare `lockfileVersion`, `importers` and `packages`, so the preamble *validates* — a single-document parse succeeded and returned a `Lockfile` with 1 package and an empty workspace. Silent, and shaped exactly like a legitimate answer.

`src/internal/documents.ts` owns framing. The rule is **deterministic, not a heuristic**: the lockfile is the **last** document, because pnpm's writer composes the preamble as a *prefix* (`writeEnvLockfile` emits `${env}---${main}`; `extractMainDocument` reads back everything after the first separator). Position is the only discriminator — keys do not tell the documents apart.

- `selectPnpmDocument` — last document wins. An env-only lockfile (preamble, empty trailing document) fails typed; pnpm itself reads such a file as having no lockfile, and we never fall back to the preamble.
- `selectSoleDocument` — yarn. yarn defines no document framing, so a multi-document `yarn.lock` fails typed rather than being silently truncated to its first document. We refuse to guess where the format states no rule.
- npm (`JSON.parse`) and bun (`Jsonc.parse`) never shared the assumption: a second top-level value is a syntax error in both. `__test__/documents.test.ts` pins that rather than assuming it.

`LockfileFramingError` carries typed fields (`format`, `documents`, `reason`), not a `cause` — there is no foreign throwable to wrap, because the text parsed fine. `reason` is `"noLockfileDocument"` (no lockfile document in the stream, incl. empty content), `"noImporters"` (the located document declares no importers, so it describes no workspace — pnpm always records at least `.`) or `"unexpectedDocuments"` (multi-document input to a format with no framing).

The invariant: **an unlocatable lockfile fails typed; it never returns an empty `Lockfile`.** An empty result is indistinguishable from "this workspace has no packages", which is what kept the bug invisible.

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
