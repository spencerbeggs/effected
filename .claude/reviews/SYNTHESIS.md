# Child-repo review synthesis

Ten parallel reviews of the source repos against `.claude/design/effected/effect-standards.md`, 2026-07-06. Per-package reports live in this directory; this file records the cross-cutting themes, inventory corrections, and skill-worthy lessons.

## Cross-cutting themes

### The kind-based folder layout is actively harmful (not just verbose)

Every multi-concept package pays a structural tax for the `errors/`/`schemas/`/`services/`/`layers/` split:

- **Import-cycle suppressions**: 11 `biome-ignore noImportCycles` in xdg-effect, 8 in json-schema-effect.
- **Static-wiring hacks**: semver-effect and workspaces-effect both assign cross-cutting statics from `index.ts` at module load (`declare static` + wiring) to dodge circular imports — forcing `sideEffects` declarations, unsafe deep imports, duplicated inlined logic, and test suites that exist only to verify the wiring.
- **Concept smearing**: package-json-effect spreads one concept across 4 files; runtime-resolver has a 21-file strategy×runtime layer matrix that collapses to ~9 concept files.

Module-per-concept dissolves all of it. This is now evidence-backed, not aesthetic.

### The `*ErrorBase` api-extractor export ceremony is universal

semver (10 pairs), workspaces (15), package-json (20 exports for 10 errors), type-registry (12), yaml — all carry doubled error surfaces as an api-extractor workaround. Dies with `Schema.TaggedErrorClass`.

### Error ladders drift: dead, misnamed, or stringly

- **Dead errors** (exported, never raised): semver 2, jsonc 1, yaml 4 of 8 (including `YamlParseError` while real parse failures raise `YamlComposerError`), runtime-resolver 2, type-registry 2 of 6. config-file has dead *events*.
- **Stringly causes**: config-file's single `ConfigError { reason: String(e) }` (under-differentiated; `catchTag` useless), xdg's `reason: String(e)`, type-registry's `message: String(error)` forcing substring-matching classification.

Redesign rule: derive each package's error set from actual raise sites; every foreign failure wraps with `cause: Schema.Defect`; never `String(e)`.

### Observability is absent everywhere

Zero `Effect.fn`/spans across the fleet — except workspaces-effect's `withSpan` naming discipline, which converts one-for-one to `Effect.fn` names. Instrument at public operation boundaries only (~5–8 per package).

### Tests are the biggest uniform chore

Plain vitest + `runPromise` (often co-located, e.g. jsonc's single 2,037-line file) everywhere. Conversion target: `it.effect` + `layer()` groups in `__test__/`, unlocking `TestClock` for TTL/cache paths. Assets: yaml's 1,226/1,226 yaml-test-suite compliance harness (makes aggressive redesign safe; vendoring strategy needed), workspaces' typed mock layers.

### Layer memoization violations

Static getters returning fresh layers per access (json-schema `Live`/`Test`, xdg layer-factory getters) defeat memoization-by-reference. Layers bind to constants.

### Peer-closure state

Pure libs (jsonc, yaml, semver) are clean — `effect` only, trivially complete. Boundary libs leak: xdg defective (undeclared `@effect/experimental`, unclosed platform-node peers), workspaces' regular deps' `effect` peers escape to the consumer importer (the systems#228 pattern), runtime-resolver has a phantom `@effect/platform` peer plus CLI peers leaking onto API consumers, type-registry declares `@effect/sql` it never imports and a `semver-effect` dep it never uses.

### v4 dividends (things v4 gives us for free)

- Platform merge into `effect` core → most boundary libs' target peer closure collapses to `effect` only. This **kills the package-json split motivation**.
- `Schema.toJsonSchemaDocument` supersedes json-schema-effect's core generation path (moat shifts to TOML tooling: tombi/taplo, Ajv gate, scaffolder).
- `decodeTo` transformations → `SemVer.FromString`-style codecs get round-tripping + `toArbitrary` free.
- v4 `Config`/`ConfigProvider` invites an additive config-file integration (FirstMatch/LayeredMerge as provider fallback).
- Triplicated data-first/data-last/floating APIs collapse to instance methods + selective dual statics.

## Inventory corrections and decisions surfaced

| Package | Correction / decision |
| --- | --- |
| json-schema | Tier → **boundary** (writes load-bearing for silk-release-action). Core generation superseded by v4; keep one package, Scaffold/Tombi/Taplo seam clean if split later. config-file does NOT consume it; xdg's use is a dead facade. |
| package-json | **Split reversed**: stay one boundary package, IO confined to `PackageJsonFile.ts` (future split = one-module extraction). |
| workspaces | `@effected/lockfiles` extraction **confirmed clean** after two repairs (importer-path resolution out of reader; integrity made pure) → lockfiles lands pure-tier. Fold `TopologicalSorter` + `PackageResolver`; delete Request/RequestResolver cache machinery. |
| xdg | New extraction candidate: SQLite cache/state → `@effected/sqlite-*`; post-split xdg is a small fs+env boundary lib peering on `effect` + `@effected/config-file`. Cut json-schema dependency. |
| yaml / jsonc | Pure tier confirmed. Strategy: **API-contract parity first**; only justified extraction is a later `@effected/text-edit` micro-kernel (Edit/Range/Path/diff). config-file consumes both via thin adapter codecs on its side. |
| runtime-resolver | Effect v3 already; boundary confirmed. Drop Octokit (v4 core `HttpClient`); **split CLI into its own package** (peer leakage); depends on `@effected/semver` → sequenced after semver. |
| type-registry | `TypeRegistry` facade should BE a `Context.Service`. Extract `createTypeScriptCache` (sole reason for `typescript` peers). `@effect/sql` surface entirely indirect → collapses behind `@effected/xdg workspace:*`. Remove unused `semver-effect` dep or use it. |
| config-file | Ship JSON codec in core; TOML behind subpath/optional dep; watcher deferred to phase 2. Error model redesign is the headline work. |
| semver | Trim surface 32 files → ~10; don't port `VersionFetcher`, 2 dead errors, `prettyPrint`; `VersionCache` stays but flagged as future subpath/split candidate. |

## Migration-order implications

1. **semver** (first, already decided) — also unblocks runtime-resolver and package-json (`SemVer` in public API).
2. **jsonc** then **yaml** (pure, self-contained; settle the shared API contract between them).
3. **package-json** (needs semver).
4. **config-file** (consumes jsonc/yaml adapters), then **xdg** (+sqlite extraction), then **json-schema**.
5. **workspaces** (+lockfiles extraction; needs jsonc/yaml/semver), **type-registry** (needs xdg/semver), **runtime-resolver** (+CLI split; needs semver).

## Skill-worthy lessons for the "effective" plugin

1. Module-per-concept rationale, with the import-cycle/wiring-hack evidence.
2. Error ladder design: derive from raise sites; `cause: Schema.Defect`; never `String(e)`; no `*Base` ceremony.
3. Layer memoization by reference: constants, never getter factories.
4. Complete peer closures (systems#228 pattern) — now with per-tier v4 targets.
5. Plain-vitest → `it.effect` + `layer()` conversion recipe.
6. `Effect.fn` at public operation boundaries only.
7. v4 supersession checklist: what to re-verify against core before porting workarounds (JSON Schema generation, platform imports, Config).
