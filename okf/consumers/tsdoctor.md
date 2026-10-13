---
type: Consumer
title: spencerbeggs/tsdoctor
description: A library monorepo generating API documentation from TypeScript API Extractor models — loads api.json models, resolves external types into a virtual TypeScript environment for Twoslash, fetches versioned documentation bundles, and renders into an RSPress site.
repository: spencerbeggs/tsdoctor
status: stable
tags: [bundle, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: f33ef71ee8561f17
---

# spencerbeggs/tsdoctor

`spencerbeggs/tsdoctor` generates API documentation from TypeScript API
Extractor models: a monorepo of `@tsdoctor/*` libraries plus the
publishable RSPress adapter `rspress-plugin-api-extractor`. It loads
`api.json` models, resolves external type definitions into a TypeScript
virtual file system for Twoslash, discovers and fetches versioned
documentation bundles, and renders the result into a docs site. Verified
against the checkout at `/Users/spencer/workspaces/spencerbeggs/tsdoctor`,
2026-09-02.

It is this register's only **library monorepo** — every other entry is
one deployable. That changes what it asks of the kit: its own consumers
are other people's builds, so a kit package it depends on becomes part of
*its* published peer closure, and the peer/optional-peer split is a
first-class design concern rather than an install detail.

It is also the kit's heaviest [`@effected/store`](../modules/store.md) and
`@effected/xdg` consumer by a wide margin, and the first to drive both
from inside a build pipeline rather than a CLI. Two dogfood rounds have
run against this repository; round 1 asked for options on shipped
surfaces, and round 2 — the first in the register — asked for, and got, a
brand-new kit package.

## What it exercises

Durable local state as build infrastructure: three separate SQLite
databases under one XDG namespace — an incremental-build snapshot store
(`@tsdoctor/snapshot`), a Twoslash type-check result cache, and a
package-metadata cache. `Store.layerSqlite` carries schema-versioned
migrations; `Cache.layerSqlite` carries the TTL half. Running `store`
against real databases that survive between processes, in a workload
where a cold cache is the difference between a fast and an unusable docs
build, is what surfaced the sqlite layer's option axis and, with it, a
WAL-finalizer option (`checkpointOnClose`) that `@tsdoctor/snapshot` now
sets.

`AppDirs` as the one namespace everything hangs off: bundle fetches, type
caches and every database resolve under a single `"tsdoctor"` XDG
namespace. The packages that need a directory keep `AppDirs` in `R` and
let the top-level adapter decide where it points — the same posture
`@effected/walker` takes with `FileSystem | Path`.

Registry and release fetching, composed rather than absorbed:
`BundleFetch.ts` reaches `@effected/npm`'s `NpmRegistry` and
`PackageTarball` for the npm path and
[`@effected/github`](../modules/github.md)'s `GitHubRelease` for the
release-asset path, caches both under the XDG cache, and normalizes the
two unpack roots — npm's `package/` and the release asset's `meta/` —
behind one locator. The kit supplies the fetch and the cache; which
artifact is authoritative is the bundle spec's own question.

The pure document tier, at the seams a renderer cares about:
[`@effected/markdown`](../modules/markdown.md)'s
`Markdown.parsePhrasingResult` replaced a full parse plus a `Paragraph`
splice for prose cross-linking, and the package's MDX vocabulary has a
dedicated proof-consumer suite here — the closest thing that vocabulary
has to an external gate. [`@effected/jsonc`](../modules/jsonc.md)'s
`JsoncFingerprint` supplies RFC 8785 canonicalization plus SHA-256 for
change detection, and `@effected/package-json`'s `LenientManifest.parse`
is the manifest reader used during bundle discovery — field-level
degradation where a strict decode would refuse a directory the tool
merely wants to classify.

Optional peers, used as designed: `@tsdoctor/registry` declares
`@effected/xdg` as an *optional* peer held behind a lazy `import()`,
alongside required peers on `effect`, `@effect/platform-node`,
`@effected/semver` and [`@effected/store`](../modules/store.md). The rule
it enforces downstream is the kit's own: anything that peers on `effect`
must stay a peer, because a nested `effect` copy strands artifacts at
import.

`@effected/memfs` as the filesystem double: its filesystem-facing test
suites provide memfs rather than a hand-rolled `FileSystem` stub — the
same rule this repository holds itself to, arrived at independently.

## What round 1 proved that the earlier loops did not

A shipped surface meeting its second real-world environment asks for
options, not new capabilities. `store`, `yaml`, `markdown` and
`package-json` had all released before this consumer arrived, and none of
its asks were "the kit cannot do this" — they were driver options a
durable-SQLite consumer needs to pass through, a compatibility mode for a
downstream YAML 1.1 resolver, and synchronous primitives beside effectful
ones. Each is additive by construction and costs the kit nothing to
grant, which is the tell that separates an option ask from the genuine
absences the reposets consumer found.

An option ask still carries a design ruling. Granting the sqlite driver's
options meant excluding two of them: name-transform options that rewrite
the internal migration ledger's result names would make `status` report
every migration pending while a `Cache` query reads snake_case columns
underneath. The right answer to "pass the driver's options through" was
the record minus the two options that break the layer's own invariants,
excluded at the type level so the exclusion cannot be argued with at a
call site.

The option axis is where hazards hide, because the surface already looks
finished: `Store.layerSqlite` is a parameterized factory, and layers
memoize by reference, so calling it inline at two provide sites opens the
same database twice. That trap only bites a consumer wiring several
databases at once — a single deployable with one database never meets it.

## Round 2: the loop that produced a package

Round 1 asked for options on shipped surfaces. Round 2 asked for a
package and got one — every item delivered and adopted downstream without
drift, the first dogfood loop in this register whose output was a new kit
member rather than an extension of an existing one.

The trigger was a framework-neutral `@tsdoctor/seo` workspace deriving
JSON-LD for a documented TypeScript package. The split that produced
`@effected/schema-org` generalizes: the vocabulary half of a consumer's
work is domain-neutral and belongs upstream, while the mapping from a
specific consumer's data is the consumer's own. Under that split
`tsdoctor` holds exactly one thing — *API model + manifest → these
nodes* — and the kit holds what a `TechArticle` is. `@effected/spdx` draws
the same line: it knows what `Apache-2.0 WITH LLVM-exception` means and
nothing about `package.json`.

The remaining round-2 items are all projections between packages the kit
already had:

- `@effected/spdx` license metadata. A consumer rendering a license needs
  a title and a link, both derivable from data the package did not yet
  ship; `License` gained `referenceUrl` / `name` / `osiApproved` /
  `fsfLibre` over a generated table, which the committed catalog behind
  it now needs to keep refreshed.
- `SpdxExpression.primaryLicense` / `licensesOf`. The ask was "give me
  *the* license"; the answer is a pair, with `primaryLicense` returning
  `none` for a conjunction rather than picking a term arbitrarily —
  declining to choose forces the call site to confront the ambiguity,
  which is what a boundary should do.
- `licenseExpressionOf`. The gap between npm's `license` field and the
  SPDX grammar (`UNLICENSED`, `SEE LICENSE IN <file>`) is knowledge two
  kit packages jointly own, and every consumer had been rediscovering it;
  it is now a function rather than a paragraph of advice.
- `Repository.directoryUrl`. A monorepo member's `browseUrl` is the
  repository's own location, so every member of a repo now reports the
  same one — exactly what a docs site's structured data needs to tell two
  packages apart.
- `Funding`. This field had been deliberately excluded from
  `@effected/package-json` pending a stated release condition, and this
  loop is what met that condition — the work here was checking whether
  the condition had fired, not relitigating the field.
- A `Repository`/`Bugs` fidelity bug, found while adding the above: both
  fields replayed a remembered *object* wire form unconditionally, so an
  instance edited after decoding re-encoded as the stale original and the
  edit silently vanished.
- Two undocumented build rules, both found by building the new package
  rather than by review: a case-collision trap a subpath entrypoint
  brings, and the `"sideEffects": false` × entrypoint-split interaction
  that is the entire justification for using a subpath at all.

What round 2 proves that round 1 did not: a consumer can name a package
into existence, and the test for whether it should is the same
domain-neutrality test used for an extraction. Round 1's asks were option
axes on finished surfaces — cheap to grant, hard to get wrong. Round 2
required deciding that a vocabulary nobody in the kit consumed belonged in
the kit anyway, on the strength of a single consumer; what made it
decidable was not the consumer count but the shape of the split — the
half that was asked for is defined by an external standard and has no
`tsdoctor` in it.

The second-order finding is a warning about the kit's own habits: two of
`@effected/schema-org`'s central design decisions — declining an
`@effected/spdx` edge for `license` and an `@effected/semver` edge for
`version` — are cases where the kit's instinct was wrong and the
consumer's domain was right. Schema.org's ranges are `CreativeWork | URL`
and `Number | Text`, so both edges would have rejected legal input to
serve a coincidence of naming. A kit building a vocabulary package must
take the vocabulary's own contract over its grammar packages' habits, and
the pull the other way is strong enough to be worth naming explicitly.

## Where the kit's edge sits

- API Extractor and TSDoc, entire. `@microsoft/api-extractor-model` and
  `@microsoft/tsdoc` are this repository's own runtime dependencies, and
  the kit owns nothing in that space: model loading, TSDoc extraction,
  categorization, route and collision computation, synthetic-base
  detection and signature formatting are all downstream.
- The Twoslash and virtual-filesystem stack — `@typescript/vfs`,
  environment construction and the jsDelivr type fetch. `@effected/tsconfig-json`
  answers what a `tsconfig` *says*; what a virtual TypeScript environment
  needs is this repository's own concern.
- The bundle spec — the discovery ladder, the provenance tiers and their
  ranking, the `tsdoctor.json` manifest shape and the change-detection
  model. The kit supplies canonical hashing and fetching; which
  provenance tier wins is the spec's question.
- RSPress integration — routing, React components, i18n and versioning.
  The adapter is a platform, not a kit concern.

## Open questions

- Three databases, one namespace and no shared wiring construct. The
  snapshot store, Twoslash cache and metadata cache each build their own
  layer over a path derived from the same `AppDirs`. `@effected/app`
  exists for exactly this shape, and this consumer does not use it — it
  predates that package's reach and has no CLI entry point to hang it
  off. Whether `app` should serve a library monorepo's build pipeline, or
  is deliberately terminal-shaped, has not been asked.
- The MDX vocabulary's only external gate lives here.
  [`@effected/markdown`](../modules/markdown.md)'s MDX construction and
  serialization surface is proven by exactly one downstream test suite. A
  second consumer is what would distinguish a general vocabulary from one
  transcribed for a single renderer.
