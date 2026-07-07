---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 85
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - packages/semver.md
  - packages/jsonc.md
---

# Package inventory

## Overview

Living map of source repos (under `/Users/spencer/workspaces/spencerbeggs/`) to target `@effected/*` packages. Status is updated as each migration lands, per step 7 of [migration-playbook.md](migration-playbook.md). Tier definitions are in [effect-standards.md](effect-standards.md); tier assignments and extraction candidates below reflect the completed reviews and are confirmed at migration time.

## Review findings (2026-07-06)

All ten source repos were reviewed against [effect-standards.md](effect-standards.md). Per-package reports live in `.claude/reviews/` and the cross-cutting synthesis in `.claude/reviews/SYNTHESIS.md`. The tier corrections, split decisions and provisional migration order below come from those reviews.

## Migration table

| Source repo | Target package | Tier (provisional) | Status | Notes |
| --- | --- | --- | --- | --- |
| semver-effect | @effected/semver | pure | migrated (feat/semver-migration, pending merge) | First migration; DX exemplar; design: [packages/semver.md](packages/semver.md) |
| jsonc-effect | @effected/jsonc | pure | migrated (feat/jsonc-migration, pending merge) | Second migration; design: [packages/jsonc.md](packages/jsonc.md); yaml parity convention recorded there |
| yaml-effect | @effected/yaml | pure | not started | Pure tier confirmed; parity with @effected/jsonc; only justified extraction is a possible later @effected/text-edit micro-kernel (Edit/Range/Path/diff), decided after both ports |
| json-schema-effect | @effected/json-schema | boundary | not started | File writes are load-bearing for silk-release-action; core JSON Schema generation superseded by v4 `Schema.toJsonSchemaDocument` — remaining value is TOML tooling (tombi/taplo builders, Ajv validation, scaffolder); one package, Scaffold/Tombi/Taplo seam available if split later |
| package-json-effect | @effected/package-json | boundary | not started | Split candidate reversed by review: stays one package with IO confined to a single `PackageJsonFile.ts` module (the v3 split motivation — the @effect/platform peer — evaporates in v4); a future split is a one-module extraction |
| xdg-effect | @effected/xdg | boundary | not started | Extraction candidate: SQLite cache/state services → a separate @effected sqlite package (name TBD at migration); post-extraction xdg is a small fs+env boundary lib; its json-schema-effect dependency is a dead facade and gets cut |
| config-file-effect | @effected/config-file | boundary | not started | JSON codec in core; TOML behind subpath/optional dep; JSONC/YAML via thin adapter codecs over @effected/jsonc and @effected/yaml; file watcher deferred to a later phase; error-model redesign is the headline migration work; confirmed it does NOT depend on json-schema-effect |
| workspaces-effect | @effected/workspaces | boundary | not started | @effected/lockfiles extraction confirmed clean (pure tier) after two pre-repairs: importer-path→name resolution moves out of the lockfile reader and integrity checking becomes pure |
| type-registry-effect | @effected/type-registry | boundary | not started | TypeRegistry facade becomes a Context.Service; createTypeScriptCache extraction candidate; @effect/sql surface is entirely indirect and collapses behind @effected/xdg; unused semver-effect dependency to remove-or-use |
| runtime-resolver | @effected/runtime-resolver | boundary | not started | Boundary confirmed (already Effect v3 internally); new split candidate: its @effect/cli binary moves to a separate CLI package (peers currently leak onto API consumers); depends on @effected/semver so it sequences after semver |

Extraction candidates recorded above are surfaced by review; final decisions land during each migration's design.

## Migration order (provisional)

Dependency sequencing from the review synthesis (`.claude/reviews/SYNTHESIS.md`). semver first is decided; the order after it firms up as lessons land, per [migration-playbook.md](migration-playbook.md).

1. semver
2. jsonc
3. yaml
4. package-json
5. config-file
6. xdg (+ SQLite extraction)
7. json-schema
8. workspaces (+ @effected/lockfiles extraction)
9. type-registry
10. runtime-resolver (+ CLI split)

## External consumers (stay in their own repos)

Downstream projects that consume published `@effected` packages but do not migrate in, per the libraries-only scope in [architecture.md](architecture.md):

- rolldown-pnpm-config
- vitest-agent
- rspress-plugin-api-extractor
- the `@savvy-web/*` silk system (silk-*-action repos)
