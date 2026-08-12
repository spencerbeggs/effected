---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 94
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - package-json.md
  - workspaces.md
  - lockfiles.md
  - semver.md
  - commands.md
---

# @effected/npm design

## Overview

`@effected/npm` owns four things:

- The **dependency-resolution contracts** a package.json-document library defines but cannot implement — `CatalogResolver` and `WorkspaceResolver`, resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions.
- The **cross-cutting npm vocabulary** that flows between the manifest, lockfile and workspace packages: `DependencySpecifier`, the dependency-section literals, `IntegrityHash`, `PackageManagerPin`, `PackageManagerCache` and the [`ReleaseAgeGate`](#releaseagegate).
- The **[`Manifest` domain model](#manifest-tolerant-manifest-level-resolution)** — manifest-level resolution built on the per-specifier contracts.
- The **[registry and publish services](#the-service-half-registry-reads-and-publishing)** — `NpmRegistry` and `PackagePublish`, which do their own IO through core contracts in `R`.

Resolution lives here rather than in package-json because it fundamentally requires workspace and catalog context that a manifest library cannot have; the full rationale is [resolution belongs to @effected/npm](package-json.md#resolution-belongs-to-effectednpm). The vocabulary lives here because these scalars are shared by three or more packages, and a single home stops each from prefix-sniffing its own reimplementation.

**Scope discipline.** API ships on evidence: a concept moves here only when a second consumer materializes. `PackageName` stays in [package-json](package-json.md) because it has one consumer. The [vocabulary registry](#vocabulary-registry) records where every npm concept lives so nobody rebuilds an idiom for lack of a map.

## Tier and dependencies

**Boundary tier.** Not by [R2](../effect-standards.md#dependency-policy) — the `@effected/commands` edge is boundary and carries zero runtime dependencies, and boundary does not propagate — but by **[R4](../effect-standards.md#dependency-policy)**: the package performs IO itself, through core-declared contracts (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Path`, `Crypto`) required in `R`. That is the walker/xdg/git shape, and it is what boundary means.

`peerDependencies` is `effect` plus one pure-to-pure `@effected/semver` edge, used only so the range case validates through `Range.FromString`. `dependencies` is `@effected/commands` and nothing else — still **zero external runtime dependencies**.

The dependency arrows otherwise point **at** this package: `@effected/package-json`, `@effected/lockfiles` and `@effected/workspaces` all depend on it.

### The tier guardrail, and it is enforced

**Nothing downstream moved when this package became boundary.** `@effected/lockfiles` stays **pure** and `@effected/package-json` stays **boundary**: [R3](../effect-standards.md#dependency-policy) is explicit that a boundary dependency does not propagate, because the IO is discharged by the application's platform layer at the edge.

That holds only while two things stay true, and `__test__/reachability.test.ts` asserts both from the source graph:

1. **The pure vocabulary modules must not reach IO.** `IntegrityHash` and its siblings import neither service nor `@effected/commands`, so a consumer importing vocabulary links no HTTP client and no subprocess runner.
2. **`index.ts` must export individually.** A namespace object is one live binding — a bundler cannot see through it, so importing `IntegrityHash` through one would retain every member's graph. This is the [config-file codec precedent](../effect-standards.md#no-barrel-re-exports) one package over: **never group the services into an `Npm` namespace object**, and never collect the vocabulary and the services behind one const.

The test is proven discriminating — adding a `commands` import to a vocabulary module fails it — and it exists because the guardrail was otherwise only prose. Do not weaken it, and do not "tidy" `index.ts` into a namespace.

**The escalation, if it ever comes.** The moment either service takes a *non-core* runtime dependency — an npm client library, a tarball reader, a registry SDK — this package becomes **integrated**, and then R2 *does* propagate: `lockfiles` (pure) and `package-json` both move with it, and every consumer of those pays. The answer then is not "accept an integrated npm" but **split the services into their own package**, leaving the contracts and vocabulary pure here. That split was considered and rejected for now because the services' densest dependency is this package's own vocabulary, so splitting today buys a package boundary between two halves that talk constantly. **The trigger to revisit is the guardrail above, not taste.**

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every concept file imports explicitly, no barrels. See `src/` for the full list. The placements that are decisions rather than mechanics:

- **`WorkspaceResolver.ts` owns `DependencyResolutionError`** (both resolvers raise it), and `CatalogResolver.ts` type-imports it — a one-way edge.
- **`CatalogAssemblyError.ts` and `PublishError.ts` are leaf modules**, not residents of the module that raises them, because two modules must reference each without an import cycle. Same reasoning both times.
- **`index.ts` owns the composite `Default` layer** (both no-op resolver layers merged), because merging them is the cycle-free home.

Every class factory is written **inline**, with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts`, per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). A `suppressed: 0` in the prod gate means the build did not run properly.

## Resolver contracts

Both contracts are `Context.Service` with the shape inlined structurally, and no-op layers bound to a const so they memoize by reference.

- **`CatalogResolver.rangeOf`** takes a package name and an `Option` catalog name — `None` meaning the default catalog — and answers the configured range, or `None` if unresolvable.
- **`WorkspaceResolver.versionOf`** answers the concrete version without the range modifier, or `None`.
- **`DependencyResolutionError`** is reserved for **mechanism failure**. An unmatched specifier is the `None` convention, not an error.
- **`CatalogAssemblyError`** is the typed failure of catalog *assembly*, and it lives here rather than in the implementing package because **the contract package owns the contract's error vocabulary**. When it lived downstream, `rangeOf` could only name `DependencyResolutionError`, so implementations folded assembly failures into its defect `cause` and every consumer `_tag`-sniffed `unknown` to tell an assembly failure from a resolution failure. With the error beside the contract, `rangeOf`'s channel is the typed union and the sniffing adapter dies in every consumer. `@effected/workspaces` imports it back from here and deliberately does **not** re-export it, so there is exactly one home.
- **`Default`** is the composite layer a consumer provides when it just needs resolution to type-check while resolving nothing.

`@effected/workspaces` implements both contracts directly as layers over its own services ([workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)).

## Manifest: tolerant manifest-level resolution

`Manifest` is the manifest-level resolution the per-specifier contracts could not offer alone: a `Schema.Class` domain model of a **tolerant** manifest.

**The wire codec is deliberately tolerant, and the tolerance boundary is precise.** The four dependency fields are typed `string→string` records and **validate** — a malformed dependency field, or a non-record input, fails typed. **Everything else round-trips unvalidated**: the codec partitions the four dependency field names into typed members on decode and lands every other top-level key verbatim in a `rest` catch-all, flattened back to the top level on encode, so no literal `rest` key ever appears on the wire. The rationale: mid-build manifests are arbitrary user records, and forcing them through package-json's strict `Package` decode would fail resolution on fields this module never reads. Consumers wanting the strict model use `Package`.

The surface is a decode static, a pure `needsResolution` getter (the fast-path predicate that lets callers skip catalog assembly entirely), an instance `resolve()` returning a **new** `Manifest` rather than mutating, and an encode back to the wire shape.

**`UnresolvedDependencyError`** is the manifest-level reading of the contracts' `None` convention: the resolution *mechanism* worked, the answer was empty, and a manifest with an unanswerable specifier cannot be projected to concrete ranges. It is distinct from the mechanism errors by design; the per-specifier contracts keep their `None`-is-success convention untouched.

## DependencySpecifier

One specifier grammar spans the kit — lockfiles, workspaces and package-json all classify a specifier the same way. The branded string is the ground truth, with classification statics distinguishing the full protocol set. package-json re-exports the specifier vocabulary from here for surface compatibility, so the home is source-transparent to its consumers.

A `FromString` codec decodes the brand to a **coarse five-case tagged union** — catalog, workspace, semver range, dist-tag and a raw fallback — grouping the protocols the *resolvers* distinguish while the finer classification survives as the statics.

**Exact-string round-trip is structural, not reconstructed.** Every union case stores the original raw string and encoding returns it, so decode∘encode is byte-for-byte identity by construction rather than by re-serializing classified fields. That is what lets brownfield consumers reimplement on the new model without ever losing the raw specifier; a property-based round-trip suite pins it.

**Resolution projections live with the specifier.** Extracting a catalog name and applying pnpm's publish-time workspace projection are both statics here, and the classified instance's own resolve applies the same projection. Each projection has **one** internal implementation shared between the static, the classifier and the instance method, so they can never disagree.

## The vocabulary modules

- **`DependencySection`** — one concept as two literal schemas: the short dependency kinds and the manifest field names, with a single source-of-truth mapping and its inverse derived from it. Replaces the private copies package-json, lockfiles and workspaces each carried.
- **`IntegrityHash`** — an SRI brand covering **three** textual forms, because lockfile integrity is not all-SRI: npm/pnpm record SRI, corepack records its own pin form, and yarn Berry records cache checksums. Dropping the yarn form would silently discard integrity the [lockfiles](lockfiles.md) model treats as load-bearing. `CorepackIntegrityHash` is the corepack-only narrowing shared with package-json's manifest field, so both sides assert against one home.
- **`PackageManagerPin`** — the corepack pin triple as a first-class class, independent of any package.json field. It shares the strict version ruling with package-json's field model but deliberately diverges on the name grammar: the pin vocabulary is a closed literal set where the field model is permissive.
- **`PackageManagerCache`** — the per-manager default-cache-directory facts table: a pure function of manager, platform and home that a CI action, a workspace tool or a doctor command can all read without a runner, a filesystem or a subprocess. The alternative is shelling a config query per run for a value that on a freshly provisioned machine is always the default. **Every row is cited to the manager's own authority on the member**, because two of the three prior-art rows it replaces were folklore and wrong. yarn is two rows, because the two majors cache differently and nothing about a bare manager name says which is in play.

## ReleaseAgeGate

pnpm's publish-time **release-age gate** is shared npm vocabulary, so it is resident here. pnpm refuses to install a version younger than a configured cutoff; a resolver that picks the highest in-range version with no publish-time awareness picks a version pnpm then rejects. Mirroring the gate at resolution time — drop too-young candidates before picking — fixes it.

This is a **schema-first port of the gate vocabulary only**, and three behaviours carry the design:

- **`combine` is variadic and total.** It assembles the effective gate from partial contributions across sources: **strictest age wins**, exclude sets **union** into a deduplicated, sorted, contribution-order-independent wire form, and zero contributions yield the inert zero gate. It never throws — which is why the partial input shape does not clamp; `combine` is the single clamping authority.
- **Exclude matching is flat-string with `@pnpm/matcher` parity, where `*` crosses `/`.** A bare `*` matches a scoped name and a scope pattern matches a whole scope. This is **deliberately not [@effected/glob](glob.md)'s minimatch dialect**, where `*` refuses to cross `/`; pnpm treats the package name as a flat string, and routing through glob would silently change which packages a gate exempts. **Do not "fix" it.**
- **Version filtering is pure with a caller-supplied clock.** It drops versions younger than the cutoff and versions whose timestamp is missing or unparseable — pnpm's strict posture, that an unestablishable age is too young — while a version exactly at the cutoff is kept. It reads no wall clock and has no error channel.

**Consumer-side config readers are deliberately not resident here.** Reading the gate from workspace config keys or replayed hooks is config IO, a boundary concern; [@effected/workspaces](workspaces.md#configdependencyhooks--the-opt-in-replay-seam) owns that assembly, and this pure module is the vocabulary those readers combine into.

## The service half: registry reads and publishing

Two services replacing a shelled-out `npm` CLI wherever the work can be done structurally.

### NpmRegistry — reads over core HttpClient

Replaces every shelled `npm view`. A 404 is detected **structurally** from the typed HTTP error, not by matching an error code on stderr. Four decisions carry it:

- **The model is keyed by `(registry, package, version)`, and the registry is a per-call argument, never layer-baked.** The publish flow probes two registries for one package inside a single program, which is precisely what a layer-baked registry cannot express. This shape came from two shipped test doubles breaking: one keyed by package alone so it could not serve two versions, the other keyed by name alone so it could not answer for two registries.
- **404 is `Option.none()`, not an error** — extending the resolver contracts' `None`-is-success convention to registry reads, so the whole package answers absence one way.
- **`integrity` is typed as `IntegrityHash`**, not a bare string. The brand already lives here and already covers the form the registry stores, so typing it is free and kills a compare-two-strings-and-hope at the publish call site.
- **One error sized to the reads that exist**, discriminated by a transport/status/decode literal rather than a prose reason consumers match on.

The publish-times read deserves its own note: the registry's time document mixes per-version timestamps with two non-version keys, and every consumer that reads it raw re-derives that exclusion. **Making that split the schema's job** is why the result is a class rather than a bare record, and it feeds the release-age filter without an adapter.

**A per-version read falls back to the packument on a 405.** GitHub Packages answers the per-version endpoint with 405 regardless of credentials — not 404, not 401 — so a perfectly valid read failed as a transport-shaped error. The read now routes through the whole packument for that registry kind up front and **falls back the same way on a 405 from anywhere else**: the routing is by *observed behavior*, not by a vendor list, so a self-hosted registry with the same gap works without a code change. Two smaller facts inside it: the version is selected with `Object.hasOwn`, not a bare index, because the version number is caller input and a lookup for `constructor` must not read the prototype and hand back a "published version" that is a function; and absence stays `None` on both paths.

### RegistryKind — one classification, not four predicates

A single exhaustive classification replaces a family of boolean predicates, so a consumer `switch`es rather than composing booleans that can disagree — the prior art had one call site asking two in sequence and another negating a third to mean "everything else". **The domain match is exact-or-subdomain with a leading dot**, because a bare `endsWith` classifies a lookalike domain as the public registry, and that classification decides whether a token is sent. The same classifier decides which read path applies and whether the provenance flag is passed, since npm rejects that flag against non-npm registries and a release publishing to three registries should not lose two of them to one flag.

A display-name helper is deliberately **not** provided: it is display-only, and consumers rendering the same input as "GitHub Packages" and as "github" prove a library-canonical string serves nobody.

### PackagePublish — the npm CLI through @effected/commands

**The executor dispatch collapses into one value.** A repeated per-method package-manager option whose only job is choosing between an ambient npm and a fetch-and-run launcher becomes a single `NpmExecutor` value (ambient or dlx), because [@effected/commands](commands.md) already models fetch-and-run a package binary. OIDC trusted publishing needs a *fresh* npm rather than the runner's bundled one, so the launcher must be reachable — and `dlx` **fails typed when no launcher is available** rather than degrading to the ambient npm, because degrading reintroduces the exact OIDC failure the pinned spec exists to avoid, invisibly.

Every invocation goes through commands' `Run`, whose JSON form parses **and** schema-decodes so the two failure modes stay distinguishable. A non-zero exit is already a typed command failure; the dry run deliberately catches it and reports a negative result, because **a failed dry run is a valid answer rather than an error**.

**Token masking is hoisted, and the npmrc write is kept.** Auth setup takes a `Redacted` and masks nothing — the caller masks, because an Actions edge inside a publish library is a layering smell. What is **not** dropped is writing the auth token into an npmrc rather than passing it on argv: redaction protects this kit's error messages, not the operating system's process table, so keeping the token off argv stays the security-correct choice. The npmrc path is a **caller-supplied argument**, because resolving a home directory needs a `node:` import a boundary package may not make.

A fused probe-then-publish convenience is deliberately absent. The composition it would replace — pack once, then per target read the published version, compare integrity and publish the tarball — is consumer composition, and the fused form hardcoded one registry and could not recover from a partial multi-registry publish.

### Service conventions

Both services follow the kit's non-negotiables: all-effectful shapes, `static readonly layer` using `this`, named spans on public boundaries carrying package name, registry host and version — **never a token, never argv**. Service `R` is discharged at construction: the commands requirements are resolved in `make` and provided there, so every method's `R` is `never`. The next kit service built over commands will hit this identically.

Two doubles ship, because they are different tools: a `layerTest` taking a partial shape with unstubbed members dying loudly, and a `layerSeeded` working fake registry keyed on the full `(registry, name, version)` axis — the shape the broken call sites were hand-rolling.

## Vocabulary registry

Four packages — npm, package-json, lockfiles, workspaces — operate around overlapping npm concepts. **API ships on evidence, the registry ships the map**: an unmodeled concept stays unmodeled until a consumer materializes, but nobody rebuilds an idiom for not knowing its home.

**Standing assignments.** Versions and ranges → [@effected/semver](semver.md). Manifest shapes → [@effected/package-json](package-json.md). Lockfile shapes → [@effected/lockfiles](lockfiles.md). Workspace and monorepo semantics → [@effected/workspaces](workspaces.md). Cross-cutting scalars that flow between those concerns → here.

Anything not modeled is **preserved verbatim** — package-json rides unmodeled manifest keys in its `rest` catch-all, and the lockfiles parser normalizes into one model rather than mirroring every field. The default answer to "where does field X live" is therefore "preserved by package-json, unmodeled until a consumer asks"; the entries below are the ones where that answer is wrong or non-obvious:

| Concept | Home / note |
| --- | --- |
| `dependencies` and its three siblings | package-json models the maps; the **specifier grammar and section vocabulary are here** |
| `publishConfig` | modeled **twice, deliberately** — package-json's field and workspaces' own, an accepted duplication because `WorkspacePackage` is deliberately tolerant and takes no package-json edge |
| `packageManager` | package-json owns the *field* codec; the field-independent pin grammar is `PackageManagerPin` here, and both integrity halves share `CorepackIntegrityHash` here |
| `workspaces` | workspaces **reads** the globs and bun-style catalog keys without modeling the field; package-json preserves it. Trigger for modeling: a consumer needing to *write* it |
| `devEngines` | package-json models it; workspaces separately reads it as a detection hint |
| `license` | package-json, delegating real validity to [@effected/spdx](spdx.md) |
| legacy v1 `package-lock.json` | **not parsed** — the parser requires the modern packages map, and a v1-only lockfile fails typed |
| lockfile entry `resolved`, tree-membership flags, install-script flags | **discarded** in normalization. Trigger: provenance, install-tree or audit tooling |
| lockfile entry manifest mirrors (`bin`, `license`, `engines`, …) | discarded — package-json is the source of truth |

## Testing

Suites in `__test__/` per concept. The resolver surface is contracts, so those tests are light: the no-op layers answer `None`, a stub implementation proves the contract is implementable, and the resolution error preserves its structured cause.

The vocabulary tests carry the weight — specifier classification across the protocol set, the round-trip property, the resolution projections, the section mapping, integrity across all three forms, and the release-age gate's strictest-wins/union/totality, matcher parity and cutoff boundary cases. The manifest suite drives the tolerance boundary in both directions, plus resolution over stub resolver layers.

Registry reads run against a stubbed `HttpClient` — core-declared, no platform package — and publishing runs against commands' scripted-spawner fixture, which records argv, so **"the token never reached argv" is an assertion, not a hope**.

The claims proven by deliberate mutation, each observed red: scoped-package URL encoding; 404-as-absence; the seeded double's registry axis; the npmrc auth-key trailing slash; a failed dry run staying a result; `dlx` degrading silently; the lookalike-domain guard; and the reachability test itself.

## Deferred

**Packument caching.** Several reads fetch the same document, and the per-version read's packument fallback made that redundancy one call site larger. The fix is unchanged — a core `Cache` keyed on registry and name, with the failure and absence TTL rules the commands work established — and the trigger is a consumer's call pattern showing the waste, not the redundancy itself.
