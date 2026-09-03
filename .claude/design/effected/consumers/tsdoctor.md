---
status: current
module: effected
category: feedback
created: 2026-08-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 90
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
  - ../packages/schema-org.md
  - ../packages/spdx.md
  - ../package-setup.md
---

# spencerbeggs/tsdoctor

## Overview

`/Users/spencer/workspaces/spencerbeggs/tsdoctor` generates API documentation from TypeScript API Extractor models: a monorepo of `@tsdoctor/*` libraries plus the publishable RSPress adapter `rspress-plugin-api-extractor`. It loads api.json models, resolves external type definitions into a TypeScript virtual file system for Twoslash, discovers and fetches versioned documentation bundles and renders the result into a docs site.

It is the register's only **library monorepo** — every other entry is one deployable. That changes what it asks of the kit: its consumers are other people's builds, so a kit package it depends on becomes part of *its* published peer closure, and the peer/optional-peer split is a first-class design concern rather than an install detail.

It is also the kit's heaviest `@effected/store` and `@effected/xdg` consumer, by a wide margin, and the first to drive them from inside a build pipeline rather than a CLI — and, in [round 2](#round-2-the-loop-that-produced-a-package), the first consumer to name a new kit package into existence.

Two dogfood rounds have run against this repo. The next two sections record round 1; [round 2](#round-2-the-loop-that-produced-a-package) has its own, because its output was different in kind.

## What it exercises

**Durable local state as build infrastructure.** Three separate SQLite databases under one XDG namespace: an incremental-build snapshot store (`@tsdoctor/snapshot`), a Twoslash type-check result cache, and a package-metadata cache. `Store.layerSqlite` carries schema-versioned migrations; `Cache.layerSqlite` carries the TTL half. This is `store` running against real databases that survive between processes, in a workload where a cold cache is the difference between a fast and an unusable docs build — which is what surfaced the sqlite layer's option axis and, with it, the `checkpointOnClose` WAL finalizer that `@tsdoctor/snapshot` now sets.

**`AppDirs` as the one namespace everything hangs off.** Bundle fetches, type caches and every database resolve under a single `"tsdoctor"` XDG namespace. `@effected/xdg` is not a convenience here: the packages that need a directory keep `AppDirs` in `R` and let the top-level adapter decide where it points, which is the same posture `@effected/walker` takes with `FileSystem | Path`.

**Registry and release fetching, composed rather than absorbed.** `BundleFetch.ts` reaches `@effected/npm`'s `NpmRegistry` + `PackageTarball` for the npm path and `@effected/github`'s `GitHubRelease` for the release-asset path, caches both under the XDG cache and normalizes the two unpack roots — npm's `package/` and the release asset's `meta/` — behind one locator. The kit supplies the fetch and the cache; which artifact is authoritative is the bundle spec's question.

**The pure document tier, at the seams a renderer cares about.** `@effected/markdown`'s `Markdown.parsePhrasingResult` replaced a full parse plus a `Paragraph` splice for prose cross-linking; the package's MDX vocabulary has a dedicated proof-consumer suite here, which is the closest thing that vocabulary has to an external gate. `@effected/jsonc`'s `JsoncFingerprint` supplies RFC 8785 canonicalization plus SHA-256 for change detection, and `@effected/package-json`'s `LenientManifest.parse` is the manifest read during bundle discovery — field-level degradation where a strict decode would refuse a directory the tool merely wants to *classify*.

**Optional peers, used as designed.** `@tsdoctor/registry` declares `@effected/xdg` as an **optional** peer held behind a lazy `import()`, alongside required peers on `effect`, `@effect/platform-node`, `@effected/semver` and `@effected/store`. The rule it enforces downstream is the kit's own: anything that peers on `effect` must stay a peer, because a nested `effect` copy strands artifacts at import.

**`@effected/memfs` as the filesystem double.** Its filesystem-facing suites provide memfs rather than a hand-rolled `FileSystem` stub — the same rule this repo holds itself to, arrived at independently.

## What round 1 proved that the earlier loops did not

**A shipped surface meeting its second environment asks for options, not capabilities.** `store`, `yaml`, `markdown` and `package-json` had all released before this consumer arrived, and none of its asks were "the kit cannot do this". They were driver options a durable-SQLite consumer must be able to pass through, a compat mode for a downstream YAML 1.1 resolver, and sync primitives beside effectful ones. Each is additive by construction and costs the kit nothing to grant — which is the tell that separates it from the absence [reposets](reposets.md) found.

**An option ask still carries a design ruling.** Granting the sqlite driver options meant *excluding* two of them: the name-transform options rewrite the internal ledger's result names and would make `status` report every migration pending while every Cache query read snake_case columns. The right answer to "pass the driver's options through" was not the whole record — it was the record minus the two that break the layer's own invariants, closed at the type level so the exclusion cannot be argued with at a call site. [store.md](../packages/store.md) carries the ruling in full.

**The option axis is where hazards hide, because the surface already looks finished.** The layer-memoization trap — `Store.layerSqlite` is a parameterized factory, and layers memoize by reference, so calling it inline at two provide sites opens the database twice — only bites a consumer wiring several databases at once. One deployable with one database never meets it.

## Round 2: the loop that produced a package

Round 1 (above) asked for options on shipped surfaces. **Round 2 asked for a package, and got one** — every item delivered and adopted downstream without drift. It is the first dogfood loop in the register whose output was a new kit member rather than an extension of an existing one, which is why it is recorded separately rather than folded into the section above.

The trigger was a framework-neutral `@tsdoctor/seo` workspace deriving JSON-LD for a documented TypeScript package. The split that produced [`@effected/schema-org`](../packages/schema-org.md) is the one worth generalizing: **the vocabulary half of a consumer's work is domain-neutral and belongs upstream; the mapping is the consumer's.** Under it tsdoctor holds exactly one thing — *API model + manifest → these nodes* — and the kit holds what a `TechArticle` is. The same line [`@effected/spdx`](../packages/spdx.md) draws: it knows what `Apache-2.0 WITH LLVM-exception` means and nothing about `package.json`.

The remaining items are all **projections between packages the kit already had**, which is the shape adoption keeps taking:

- **`@effected/spdx` license metadata.** A consumer rendering a license needs a title and a link, and both were derivable from data the package did not ship. `License` gained `referenceUrl` / `name` / `osiApproved` / `fsfLibre` over a generated table; the committed catalog that feeds it brought a [refresh obligation](../packages/spdx.md#the-generator-has-two-sources-and-only-one-of-them-is-a-package) the package did not previously carry.
- **`SpdxExpression.primaryLicense` / `licensesOf`.** The ask was "give me *the* license"; the answer was a pair, with `primaryLicense` returning `none` for a conjunction rather than picking a term. In the consumer's own words, declining to choose "forces the call site to confront it, which is precisely what a boundary should do" — and that phrasing is now the [house precedent](../packages/spdx.md#reading-licenses-out-of-an-expression) the schema-org arity model is built on.
- **`licenseExpressionOf`.** The gap between npm's `license` field and the SPDX grammar (`UNLICENSED`, `SEE LICENSE IN <file>`) is knowledge two kit packages jointly own, and every consumer was rediscovering it. Closed as a function rather than a paragraph.
- **`Repository.directoryUrl`.** A monorepo member's `browseUrl` is the *repository's* location, so every member of a repo reports the same one — and that URL is exactly what a docs site's structured data uses to tell two packages apart.
- **`Funding`.** The field had been [deliberately excluded with a stated release condition](../packages/package-json.md#the-compliance-field-set), and this loop met it. Worth noting as evidence for writing exclusions that way: the work was checking whether the condition had fired, not relitigating the field.
- **A `Repository`/`Bugs` fidelity bug**, found while adding the above: both replayed a remembered *object* wire unconditionally, so an instance edited after decoding re-encoded as the stale original and the edit vanished.
- **Two undocumented build rules**, both found by building the new package rather than by review: [the case-collision trap a subpath entrypoint brings](../package-setup.md#the-case-collision-rule), and [the `sideEffects: false` × entrypoint-split interaction](../effect-standards.md#no-barrel-re-exports) that is the entire justification for a subpath.

**What this loop proves that round 1 did not: a consumer can name a package into existence, and the test for whether it should is the same domain-neutrality test used for an extraction.** Round 1's asks were option axes on finished surfaces — cheap to grant, hard to get wrong. This one required deciding that a vocabulary nobody in the kit consumed belonged in the kit anyway, on the strength of one consumer. The thing that made it decidable was not the consumer count but the *shape* of the split: the half that was asked for is defined by an external standard and has no tsdoctor in it.

The second-order finding is a warning about the kit's own habits. Two of the package's central design decisions — [declining an `@effected/spdx` edge for `license` and an `@effected/semver` edge for `version`](../packages/schema-org.md#tier-and-dependencies) — are cases where **the kit's instinct was wrong and the consumer's domain was right**: schema.org's ranges are `CreativeWork | URL` and `Number | Text`, so both edges would have rejected legal input to serve a coincidence of naming. A kit building a vocabulary package must take the vocabulary's contract over its own grammar packages, and the pull the other way is strong enough to be worth naming.

## Where the kit's edge sits

- **API Extractor and TSDoc, entire.** `@microsoft/api-extractor-model` and `@microsoft/tsdoc` are this repo's runtime dependencies and the kit owns nothing in that space. Model loading, TSDoc extraction, categorization, route and collision computation, synthetic-base detection and signature formatting are all downstream.
- **The Twoslash and VFS stack** — `@typescript/vfs`, environment construction and the jsDelivr type fetch. `@effected/tsconfig-json` answers what a tsconfig *says*; what a virtual TypeScript environment needs is this repo's.
- **The bundle spec** — the discovery ladder, the provenance tiers and their ranking, the `tsdoctor.json` manifest shape and the change-detection model. The kit supplies canonical hashing and fetching; which tier wins is the spec's.
- **RSPress integration** — routing, React components, i18n and versioning. The adapter is a platform, not a kit concern.

## Open questions

1. **Three databases, one namespace and no shared wiring construct.** Snapshot store, Twoslash cache and metadata cache each build their own layer over a path derived from the same `AppDirs`. `@effected/app` exists for exactly this shape, and this consumer does not use it — it predates that package's reach and has no CLI entry point to hang it off. Whether `app` should serve a library monorepo's build pipeline, or is deliberately terminal-shaped, has not been asked.
2. **The MDX vocabulary's only external gate lives here.** `@effected/markdown`'s MDX construction and serialization surface is proven by one downstream suite. A second consumer is what would distinguish a general vocabulary from one transcribed for a single renderer.
