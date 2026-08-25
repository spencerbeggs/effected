---
status: current
module: effected
category: feedback
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 85
related:
  - README.md
  - ../packages/store.md
  - ../packages/xdg.md
  - ../packages/markdown.md
  - ../packages/package-json.md
  - ../packages/tsconfig-json.md
  - ../packages/npm.md
  - ../packages/github.md
  - ../packages/jsonc.md
  - ../packages/yaml.md
  - ../packages/memfs.md
---

# spencerbeggs/tsdoctor

## Overview

`/Users/spencer/workspaces/spencerbeggs/tsdoctor` generates API documentation from TypeScript API Extractor models: a monorepo of `@tsdoctor/*` libraries plus the publishable RSPress adapter `rspress-plugin-api-extractor`. It loads api.json models, resolves external type definitions into a TypeScript virtual file system for Twoslash, discovers and fetches versioned documentation bundles, and renders the result into a docs site.

It is the register's only **library monorepo** — every other entry is one deployable. That changes what it asks of the kit: its consumers are other people's builds, so a kit package it depends on becomes part of *its* published peer closure, and the peer/optional-peer split is a first-class design concern rather than an install detail.

It is also the kit's heaviest `@effected/store` and `@effected/xdg` consumer, by a wide margin, and the first to drive them from inside a build pipeline rather than a CLI.

## What it exercises

**Durable local state as build infrastructure.** Three separate SQLite databases under one XDG namespace: an incremental-build snapshot store (`@tsdoctor/snapshot`), a Twoslash type-check result cache, and a package-metadata cache. `Store.layerSqlite` carries schema-versioned migrations; `Cache.layerSqlite` carries the TTL half. This is `store` running against real databases that survive between processes, in a workload where a cold cache is the difference between a fast and an unusable docs build — which is what surfaced the sqlite layer's option axis and, with it, the `checkpointOnClose` WAL finalizer that `@tsdoctor/snapshot` now sets.

**`AppDirs` as the one namespace everything hangs off.** Bundle fetches, type caches and every database resolve under a single `"tsdoctor"` XDG namespace. `@effected/xdg` is not a convenience here: the packages that need a directory keep `AppDirs` in `R` and let the top-level adapter decide where it points, which is the same posture `@effected/walker` takes with `FileSystem | Path`.

**Registry and release fetching, composed rather than absorbed.** `BundleFetch.ts` reaches `@effected/npm`'s `NpmRegistry` + `PackageTarball` for the npm path and `@effected/github`'s `GitHubRelease` for the release-asset path, caches both under the XDG cache, and normalizes the two unpack roots — npm's `package/` and the release asset's `meta/` — behind one locator. The kit supplies the fetch and the cache; which artifact is authoritative is the bundle spec's question.

**The pure document tier, at the seams a renderer cares about.** `@effected/markdown`'s `Markdown.parsePhrasingResult` replaced a full parse plus a `Paragraph` splice for prose cross-linking; the package's MDX vocabulary has a dedicated proof-consumer suite here, which is the closest thing that vocabulary has to an external gate. `@effected/jsonc`'s `JsoncFingerprint` supplies RFC 8785 canonicalization plus SHA-256 for change detection, and `@effected/package-json`'s `LenientManifest.parse` is the manifest read during bundle discovery — field-level degradation where a strict decode would refuse a directory the tool merely wants to *classify*.

**Optional peers, used as designed.** `@tsdoctor/registry` declares `@effected/xdg` and `@effected/tsconfig-json` as **optional** peers held behind lazy `import()`, alongside required peers on `effect`, `@effect/platform-node`, `@effected/semver` and `@effected/store`. The rule it enforces downstream is the kit's own: anything that peers on `effect` must stay a peer, because a nested `effect` copy strands artifacts at import.

**`@effected/memfs` as the filesystem double.** Its filesystem-facing suites provide memfs rather than a hand-rolled `FileSystem` stub — the same rule this repo holds itself to, arrived at independently.

## What this loop proves that the earlier ones did not

**A shipped surface meeting its second environment asks for options, not capabilities.** `store`, `yaml`, `markdown` and `package-json` had all released before this consumer arrived, and none of its asks were "the kit cannot do this". They were driver options a durable-SQLite consumer must be able to pass through, a compat mode for a downstream YAML 1.1 resolver, and sync primitives beside effectful ones. Each is additive by construction and costs the kit nothing to grant — which is the tell that separates it from the absence [reposets](reposets.md) found.

**An option ask still carries a design ruling.** Granting the sqlite driver options meant *excluding* two of them: the name-transform options rewrite the internal ledger's result names and would make `status` report every migration pending while every Cache query read snake_case columns. The right answer to "pass the driver's options through" was not the whole record — it was the record minus the two that break the layer's own invariants, closed at the type level so the exclusion cannot be argued with at a call site. [store.md](../packages/store.md) carries the ruling in full.

**The option axis is where hazards hide, because the surface already looks finished.** The layer-memoization trap — `Store.layerSqlite` is a parameterized factory, and layers memoize by reference, so calling it inline at two provide sites opens the database twice — only bites a consumer wiring several databases at once. One deployable with one database never meets it.

## Where the kit's edge sits

- **API Extractor and TSDoc, entire.** `@microsoft/api-extractor-model` and `@microsoft/tsdoc` are this repo's runtime dependencies and the kit owns nothing in that space. Model loading, TSDoc extraction, categorization, route and collision computation, synthetic-base detection and signature formatting are all downstream.
- **The Twoslash and VFS stack** — `@typescript/vfs`, environment construction and the jsDelivr type fetch. `@effected/tsconfig-json` answers what a tsconfig *says*; what a virtual TypeScript environment needs is this repo's.
- **The bundle spec** — the discovery ladder, the provenance tiers and their ranking, the `tsdoctor.json` manifest shape and the change-detection model. The kit supplies canonical hashing and fetching; which tier wins is the spec's.
- **RSPress integration** — routing, React components, i18n and versioning. The adapter is a platform, not a kit concern.

## Open questions

1. **Three databases, one namespace, and no shared wiring construct.** Snapshot store, Twoslash cache and metadata cache each build their own layer over a path derived from the same `AppDirs`. `@effected/app` exists for exactly this shape, and this consumer does not use it — it predates that package's reach and has no CLI entry point to hang it off. Whether `app` should serve a library monorepo's build pipeline, or is deliberately terminal-shaped, has not been asked.
2. **The MDX vocabulary's only external gate lives here.** `@effected/markdown`'s MDX construction and serialization surface is proven by one downstream suite. A second consumer is what would distinguish a general vocabulary from one transcribed for a single renderer.
