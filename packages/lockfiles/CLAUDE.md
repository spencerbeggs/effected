# @effected/lockfiles

Pure lockfile parsing for the four package-manager formats — bun (`bun.lock` JSONC), npm (`package-lock.json`), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile` model, plus pure integrity checking of that model against workspace manifests. The `LockfileReader` service (root find, PM detect, file IO, dispatch) lives in the consumer, `@effected/workspaces`, never here.

**Design doc:** `@../../.claude/design/effected/packages/lockfiles.md` — load when changing the model, the parse pipeline or either seam repair.

**Child context:** Instances and resolution → `@./CLAUDE.resolution.md` — Load when: touching `instanceId`, `resolved`, `unresolvedEdges`, peer declarations or any per-format resolution walk.

## Supported input domain

**pnpm `lockfileVersion` 9+ and npm `lockfileVersion` 3+. Older formats fail typed** (`LockfileParseError`, `stage: "validation"`, with a structured `UnsupportedLockfileVersion` cause carrying the version found and the minimum supported). This is a deliberate narrowing of the supported input domain, not an implementation detail: a consumer parsing some other repo's older lockfile now gets a typed failure by design. Older formats record resolution in a shape this model does not describe, and parsing them would hand a consumer rows that cannot answer a resolution question.

**Tested against** pnpm 11.22.0, npm 11.19.0, bun 1.3.14 and yarn 4.9.1 — a separate claim from the gate, and deliberately so. The gate is on the **lockfile format** version, which is the only version a lockfile records; the writing package manager's version is not recoverable from the file, and the mapping is many-to-one (pnpm 9, 10 and 11 all write format `9.0`). So the code cannot enforce a "requires pnpm 11+" claim and the docs must not make one.

The gate runs **before** the shape decode, in every gated format, and the order is load-bearing: the shape decoded against is the shape of a *supported* version, so a shape-first order reports the oldest formats as malformed rather than as too old. npm v1 has no `packages` object and a pre-v9 single-project pnpm lockfile has no `importers` map — both decoded straight into a `ParseFailure` cause, which `isUnsupportedLockfileVersion` answers `false` for, exactly as it does for a corrupt file. Both directions are pinned (`npm/unsupported-v1`, `pnpm/unsupported-v6-single`, and a well-formed-version/broken-shape case that must still fail as malformed).

The gate reads `lockfileVersion` and **nothing else** — never whether `snapshots:` is present or populated. A dependency-free v9 workspace legitimately records zero snapshot entries; an emptiness guard would reject that valid lockfile. Version is the format's identity, emptiness is a coincidence of content. Both directions are mutation-checked.

bun and yarn are ungated: neither records a comparable format-version line this parser keys on.

## Tier

**Pure.** No services, no layers, no IO, no `R` anywhere. Peers: `effect` plus four pure-to-pure `workspace:^` edges — `@effected/jsonc` (bun), `@effected/yaml` (pnpm, yarn), `@effected/semver` (integrity ranges) and `@effected/npm` (the shared `DependencySpecifier`/`DependencyField`/`IntegrityHash` vocabulary) — each floating a published patch and mirrored in devDependencies by the plain `workspace:*` (the two specifiers now deliberately differ). Zero external runtime dependencies; the text-parsing engines arrive through the sibling packages, so nothing is vendored here.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `Lockfile`, `LockfileParseError`, `LockfileFramingError` — from `src/Lockfile.ts`
- `LockfileFormat`, `filenameFor`, `filenamesFor`, `fromFilename` — from `src/LockfileFormat.ts`. `filenamesFor(format)` is every filename a format is genuinely written under, primary first (npm adds `npm-shrinkwrap.json`, bun adds the binary `bun.lockb`; pnpm/yarn are single-element) — detection vocabulary, not parse routing: `bun.lockb` is not a parse target and `fromFilename` keeps answering for the primary names only. Workspace-config extras (`pnpm-workspace.yaml`, `.pnpmfile.cjs`, yarn PnP files) are a consumer's cache policy and stay out.
- `LockfileImporter` — from `src/LockfileImporter.ts`
- `ImporterDependency` — from `src/ImporterDependency.ts`
- `LockfileIntegrity`, `WorkspaceManifest` — from `src/LockfileIntegrity.ts`
- `UnsupportedLockfileVersion` (type) and `isUnsupportedLockfileVersion` — from `src/UnsupportedLockfileVersion.ts`. The structured cause a version-gate failure carries, plus the predicate that narrows to it. **`LockfileParseError.cause` stays `Schema.Defect` and must**: it carries whatever the delegated engines throw, so widening it to a union would misrepresent an open channel as an exhaustive one. Exporting the type and narrowing with a predicate is the honest shape, and it is what makes the documented "discriminate on `cause._tag`, never parse prose" instruction actually typecheck. The predicate reads `_tag` as an **own** property — a foreign throwable inheriting one must not be reported to a consumer as "your lockfile is too old".
- `ResolvedPackage` — from `src/ResolvedPackage.ts`. **A row is one package *instance*, not one package**: `instanceId` is the lockfile-native identity verbatim (opaque — look it up, never parse it), `resolved` maps a dependency (and, where recorded, peer) name to the `instanceId` it resolved to, and `unresolvedEdges` names the edges the lockfile **records** but the model could not name — distinct from genuine absence, which is why a consumer must not read a missing `resolved` key as "nothing is there". Also carries `peerDependencies` and `peerDependenciesMeta` — declarations only, defaulting to `{}` on construction and on decode. Per-format identity, the resolution walks and the npm/bun exemption → `@./CLAUDE.resolution.md`.
- `WorkspaceDependency` — from `src/WorkspaceDependency.ts`
- `PnpmExtension`, `PnpmCatalogs` (type) — from `src/PnpmExtension.ts`
- `BunExtension` — from `src/BunExtension.ts`

`WorkspaceDependency.DependencyType` was **removed**; `WorkspaceDependency.depType` and `ImporterDependency.depType` now type against `@effected/npm`'s kit-wide `DependencyField`, and `ResolvedPackage.integrity` against its `IntegrityHash` (SRI/corepack/yarn `10c0/` forms; an *absent* integrity is omitted, a *present but unparseable* one fails the parse typed at `stage: "validation"`).

`LockfileImporter` (one importer's declared deps, keyed by path) and `ImporterDependency` (`name`, a `DependencySpecifier.FromString` `specifier`, optional pnpm-only `version` — always the **plain** version, peer-disambiguation suffix split off into the optional `peerSuffix` (the raw parenthesized chain); `link:`/`file:` resolutions pass through verbatim — and a `DependencyField` `depType`) are new leaf classes. The suffix split is `splitPeerSuffix` in `src/internal/shared.ts`, the single stripping implementation shared with the pnpm `packages:` key parser. `Lockfile.importers` defaults to `[]`; `lockfile.importer(path): Option<LockfileImporter>` resolves one through a lazy `#private` path index — the `packagesNamed` precedent. yarn records no importers (always `[]`); `withImporterNames` leaves them untouched (keyed on path, not name).

`Lockfile.parse(content, { format })` is the package's **only fallible boundary** (one `Effect.fn` span, no logging, no metrics). Everything else is total: `withImporterNames`, `packagesNamed`, `importer` and `packageByInstanceId` (all lazy `#private` indexes), `workspacePackages`, `LockfileIntegrity.compare`.

`packageByInstanceId(id): Option<ResolvedPackage>` is the index edge-walking consumers were rebuilding — a resolved edge points at an `instanceId`, so peer and dependency resolution is a lookup, not a scan. It mirrors `importer` exactly and deliberately: lazy (a consumer that never walks edges pays nothing), `Map`-backed (an id colliding with `__proto__` or `constructor` neither pollutes nor false-matches) and **first-wins** on a duplicate id, so a malformed lockfile gets a stable answer rather than an iteration-order one. Never reimplement it as a plain object or a scan.

Note: the integrity check is `LockfileIntegrity.compare`, not `.check` — every v4 `Schema.Class` already carries a `static check(...checks)` for attaching schema checks, so the design doc's original name is unavailable.

## The two seam repairs

1. **pnpm name resolution is an explicit second stage.** `Lockfile.parse` emits pnpm workspace packages named by importer *path* with version `"0.0.0"`; `lockfile.withImporterNames(map)` — total, pure — rewrites names and both dependency-edge ends. Manifest IO that builds the map belongs to the consumer.
2. **Integrity checking is total and pure.** `LockfileIntegrity.compare(lockfile, manifests)` takes `WorkspaceManifest` values and returns the report infallibly. v3's `LockfileIntegrityError` was deleted. `workspace:`/`link:`/`file:` specifiers and unparseable semver rows are skipped by design.

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

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`. 132 tests across six families: per-format fixture tests (`Lockfile.test.ts` over `__test__/fixtures/{pnpm,npm,yarn,bun}/v*`, plus the peer-declaration and instance-identity blocks over `<format>/peers/`, `pnpm/variants`, `pnpm/emptysnapshots`, `npm/nested`, `npm/ancestor-walk`, `bun/nested`, `pnpm/linkedpeer`, `pnpm/unnameablelink` and `yarn/devdeps`), the supported-version suite (`pnpm/unsupported-v6`, `pnpm/unsupported-v6-single`, `npm/unsupported-v1` and `npm/unsupported-v2`, all negative), seam-repair tests (`withImporterNames` in `Lockfile.test.ts`, `LockfileIntegrity.test.ts`), the importer surface (`importers.test.ts` — `Lockfile.importers`, `importer(path)`), the hostility suite (`hostile.test.ts`) and codec round-trips (`roundtrip.property.test.ts`, `it.effect.prop` over `Schema.toArbitrary`).

Fixture naming carries two conventions, both load-bearing:

- **A directory named `unsupported-*` holds input the parser must reject.** That prefix is the exclusion mechanism, not decoration: the version-gate guard (*"every non-negative fixture sits at or above its format's gate"*) **enumerates the fixtures directory** and skips exactly those, so a fixture added tomorrow is covered automatically and a negative one cannot silently opt a positive one out. Never re-hard-code that list — the one that existed had already drifted two fixtures behind reality.
- **The npm `v*` directories denote fixture *sets*, not lockfile versions.** `npm/v1` and `npm/v2` are both `lockfileVersion: 3` — the positive corpus has never held a genuine npm v1 or v2 tree, which is why the negative fixtures carry the `unsupported-` prefix and their own version in the name (`npm/unsupported-v1`, `npm/unsupported-v2`).

**Fixtures are real manager output except three**, each hand-authored for a reason no install can produce: `pnpm/emptysnapshots` (a dependency-free v9 document), `npm/unsupported-v2` (the point is the version field, not the tree) and `npm/ancestor-walk` (npm's hoisting actively avoids the intermediate-ancestor shape it encodes — a package at depth 2 resolving a name that lives at depth 1 *and* at the root).

**A pnpm fixture's `packages.length` is an instance count**, so a fixture carrying peer-variant snapshot keys has one row per variant. Expect the count to move when peer variants are added, and do not "fix" it back to a per-package number.

```bash
pnpm vitest run packages/lockfiles          # 132 tests, from the repo root
pnpm build --filter @effected/lockfiles     # from the repo root
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. A clean `dist/prod/issues.json` carries **11** `_base` `suppressed` entries; `suppressed: 0` in the *prod* gate means the build did not run.

**`suppressed: 11` in the log does not prove the build ran** — a turbo cache hit replays `FULL TURBO`, the same `✓ npm 21 files` and the same `suppressed 11` verbatim. Check that `dist/prod/issues.json`'s `generatedAt` postdates your last source edit; trust the timestamp, never the number (`@../../CLAUDE.build-and-test.md`).
