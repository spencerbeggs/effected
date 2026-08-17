---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-16
last-synced: 2026-08-16
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - workspaces-release.md
  - lockfiles.md
  - glob.md
  - walker.md
  - npm.md
  - package-json.md
  - git.md
  - commands.md
  - memfs.md
---

# @effected/workspaces design

## Overview

`@effected/workspaces` is the **integrated-tier** monorepo tooling package: the part of workspace management that only makes sense with a filesystem and a package manager under it — **workspace root discovery, package enumeration, the dependency graph, package-manager detection, catalog resolution, lockfile IO, git-based change detection and point-in-time workspace snapshots.**

The four lockfile parsers and integrity checking live in [@effected/lockfiles](lockfiles.md); glob matching lives in [@effected/glob](glob.md); typed git introspection lives in [@effected/git](git.md). This package composes all three over the workspace model.

**The release-shaped surface — publishability, versioning strategy and release tags — is documented separately in [workspaces-release.md](workspaces-release.md).** It ships from this package but forms its own subsystem, reaching the rest only through discovery and the package model.

## Tier and dependencies

**Integrated tier, and deliberately so.** The `@pnpm/catalogs.*` quartet is what makes it integrated: those packages *are* pnpm's catalog semantics, versioned to pnpm majors, and reimplementing them would mean owning a moving spec with no oracle. A catalogs-only split is a later one-module extraction if anything asks for it.

The workspace edges, and what each buys:

| Dependency | Why |
| --- | --- |
| `@pnpm/catalogs.*` | pnpm catalog semantics — the tier-3 decision |
| [`@effected/glob`](glob.md) | dependency-pattern matching and the `packages:` enumerator |
| [`@effected/lockfiles`](lockfiles.md) | the pure parsers this package feeds file content to |
| [`@effected/walker`](walker.md) | the upward ascent that finds the workspace root |
| `@effected/yaml` | `pnpm-workspace.yaml` |
| [`@effected/package-json`](package-json.md) | the full-manifest bridge and the corepack manifest-field codec |
| [`@effected/npm`](npm.md) | the resolver **contracts** this package implements |
| [`@effected/git`](git.md) | typed git introspection, under change detection and snapshots |
| [`@effected/commands`](commands.md) | the `LocalExec` **contract** this package implements, plus the JSON-line runner the subprocess hook replay uses |

There is **no `minimatch` dependency** — dependency-pattern matching and the enumerator's glob both run on `@effected/glob`'s vendored engine.

**Subprocess spawning lives entirely behind core's `ChildProcessSpawner` contract**, required in `R` and never backed here; there is no `node:child_process` anywhere.

Two modules touch Node built-ins, and **both are opt-in rather than on the main path**. `ConfigDependencyHooks` does an in-process dynamic import under one layer and spawns a `node` child under another ([the seam](#configdependencyhooks--the-opt-in-replay-seam)) — a built-in import and a spawner requirement, not dependencies, so neither affects tier. `src/node-sync.ts` imports `node:fs` and `node:path`, but it is a **separate entry point** the index never re-exports, so nothing reaches it unless a consumer imports the subpath by name ([the escape hatch](#workspacessync--the-escape-hatch)). **The main entry stays platform-free.**

## Implementing @effected/npm's resolver contracts

[@effected/npm](npm.md) defines two shape-only service contracts that `@effected/package-json` needs but cannot implement, and ships only no-op layers. **This package implements them**, because catalog resolution needs the workspace config plus the lockfile, and workspace-version resolution needs the discovered package list, both of which live here. The implementations are exported as layers over this package's own services, plus a merged convenience layer.

Provide either alongside a manifest resolve and a package.json's `catalog:` / `workspace:` specifiers resolve for real instead of answering `None`. **The contracts' convention holds exactly**: an *unmatched* name is `None`, and the error channel is reserved for a failure of the resolution *mechanism*.

**The assembly error is npm's, and it passes through typed.** `CatalogAssemblyError` lives in npm beside the contract that names it, so an unreadable or malformed catalog source passes through as that typed error rather than being folded into a resolution error's defect cause, which used to force consumers to `_tag`-sniff `unknown`. Only the remaining mechanism failure — an unfindable workspace root — is wrapped. This package imports the error back from npm and deliberately does **not** re-export it.

Two conveniences sit on top:

- **`Workspaces.resolverLayer(options?)`** pre-wires the resolvers over the config-dependency path, so the two contracts need only a platform from the consumer. It is **deliberately a parameterized layer function, and the fresh layer per call is the feature**: layers memoize by reference, so each call mints an unmemoized layer whose root discovery re-runs, including a per-call ambient-cwd read when none is given. A build tool that changes directory between manifests gets a correct re-discovery each time precisely because nothing is shared; a consumer that wants sharing binds one call's result to a `const`.
- **`Workspaces.resolveManifest`** is the one-shot path, providing a fresh resolver layer per call. Consumers processing many manifests check npm's pure `needsResolution` predicate first and skip the call — and catalog assembly — entirely when nothing needs resolving.

## Implementing @effected/commands' LocalExec contract

The second inverted contract this package fills, on the same reasoning. [@effected/commands](commands.md) needs package-manager detection and workspace-root resolution for its tool discovery, and both live here — but a direct commands→workspaces edge would make that **boundary-tier** package integrated, and through the npm→commands edge would drag npm, `lockfiles` (pure!) and package-json up a tier with it. So commands declares the narrow contract and this package ships the layer.

**The R2 direction is what makes this safe.** The commands edge is a dependency on a *boundary* package, and [R2](../effect-standards.md#dependency-policy) taxes only tier-3 edges — so taking it changes nothing about this package's tier and costs a consumer nothing extra. **The inversion exists to protect commands and its dependents, not this package.**

**The argv knowledge is not duplicated.** Commands owns the one table of the four managers' exec, dlx and script prefixes; this layer detects *which* manager owns the directory and asks commands what that manager's argv looks like. The tests assert against that same static rather than a copy, so the two packages cannot silently drift. That held with no work when a third prefix joined the record — this layer destructures whatever the table returns.

**`None` is success, and the boundary is where the value is.** The contract reserves its typed error for **mechanism** failure, so:

| Condition | Answer | Why |
| --- | --- | --- |
| No workspace root above the cwd | `None` | "No project-local way to run tools here" is an ordinary fact; a bare directory should not have to catch an error to learn it. |
| Detection found no evidence | `None` | The detector [refused to guess](#the-standalone-and-declaration-tiers). No identifiable launcher is the same honest absence. |
| A manifest that cannot be read or parsed | typed error | A manifest that exists but is broken is **not absent**. Reporting `None` would tell a caller "no local tooling" when the truth is "your repository is damaged". |

That split falls straight out of the detector's own error taxonomy, which is why it is stated rather than invented. All three rows are mutation-pinned in both directions.

The resulting context's directory is the resolved **workspace root**, not the caller's cwd: a project-local launcher has to run where the workspace is, and resolving that root is the reason this layer exists rather than a bare one in commands.

**A consumer with no monorepo never needs this layer and therefore never installs this package** — the no-op and fixed-manager forms are one-liners in commands. That asymmetry is the entire payoff of the inversion.

## The packages: enumerator

`internal/enumerate.ts` compiles the `packages:` list once and enumerates the workspace, fixing a class of degradation where a trailing globstar silently collapses to a single-level wildcard so a nested package goes undiscovered with no diagnostic. Glob's compiled-set metadata exists specifically for this enumerator.

1. Compile the list once, with default options — **there is no options surface to diverge on**.
2. **Literals** fast-path to an exact manifest existence check.
3. **Wildcards** read from the compiled enumeration prefix: a single-level read when the pattern cannot cross segments, and a **bounded iterative descent** from that prefix when it can, testing each visited directory's root-relative POSIX path against the pattern.
4. **Excludes** drop candidates after positive matching.
5. A directory counts as a workspace package only if it holds a manifest.

The descent is a **worklist, not a recursion**, so it cannot overflow the stack. It is bounded three ways: a depth cap that is integer-guarded so `NaN` and fractions die rather than silently enumerating nothing, a visited-directory budget, and unconditional pruning of `node_modules` and `.git`. A wildcard whose prefix names a nonexistent directory fails typed.

> **Core-overlap ticket (unresolved):** core ships a filesystem glob that overlaps this enumerator's traversal half — the matcher half stays `@effected/glob`, which core does not duplicate. Whether it honours the semantics this enumerator guarantees (the bounded descent, the prune list, the integer-guarded depth cap, the typed failure at a bound, and the one-state-machine discipline shared with the sync entry point) needs a behavioral probe before any replacement. **Until that probe passes, the enumerator stays.** Core's filesystem watch stream is where any future watch-mode discovery would build.

## Module layout

Module-per-concept; see `src/` for the full list. The placements that are decisions rather than mechanics:

- **`internal/catalogs.ts` is the only module that imports `@pnpm/catalogs.*`** — the tier-3 blast radius is one file.
- **`ReleaseTag.ts` is a leaf importing nothing else here**, which is what keeps the tag vocabulary pure.
- **`src/node-sync.ts` is a second package entry point**, not a module of the first.
- **`CatalogAssemblyError` is not this package's module.** It lives in [@effected/npm](npm.md) beside the contract that names it; three modules here import it, and it is not re-exported.

**Sorting and file-to-package lookup are not services**: sorting is methods on the `DependencyGraph` value class, and file resolution folds into `WorkspaceDiscovery`. There is no request-resolver cache — there is no batching win on a single-key resolver and nothing the memoized init has not already deduplicated.

### One traversal, two entry points

`internal/traverse.ts` owns the worklist, the dequeue discipline, the depth rule, the visit budget and the prune list. Both the Effect enumerator and the sync escape hatch drive it, and **neither re-decides any of those**.

The dequeue uses a **head index, never `Array.shift()`** — `shift()` re-indexes the array on every dequeue, so draining a near-budget worklist is quadratic. **The depth cap bounds what is enumerated, not merely what is descended into.**

The one deliberate divergence between the two entry points is what happens at a bound: the Effect path fails typed, the sync path truncates because it has no error channel. A test drives **both** entry points against one real tree at the boundary, because the sync copy once accepted a child before checking its depth and returned a package one level beyond the cap the Effect enumerator rejected.

### YAML stream framing is not this package's job

`pnpm-lock.yaml` carries a config-dependencies preamble document ahead of the real lockfile whenever the workspace uses config dependencies, and a first-document parse silently returns the preamble — an apparently empty workspace rather than a failure. [@effected/lockfiles](lockfiles.md#document-framing-a-lockfile-is-a-yaml-stream) owns this on a deterministic rule (pnpm's writer always emits the preamble as a prefix, so the lockfile is the **last** document) and surfaces a typed framing error when a stream carries no lockfile document. The reader here therefore calls the parser directly.

## Public surface

### WorkspacePackage

A `Schema.Class` carrying a located workspace member. It keeps a **tolerant** manifest projection rather than embedding [package-json](package-json.md)'s strict `Package`, because that model requires a valid name and a parseable semver version — so **one member with a non-semver version would fail discovery for the whole repo**. The strict model is one method away, which makes the two different entities rather than duplicates: a located member that was *discovered*, versus a fully-typed manifest that was *decoded*.

**The as-read manifest record is captured at discovery**, so a consumer needing a field outside the typed slice reads it without a second file read or a strict decode that can fail on odd manifests. Values are unvalidated beyond being a record. Two decisions around it are deliberate: **the re-reading manifest method stays**, because its point-in-time refresh semantics depend on re-reading, which a captured record cannot provide; and **the snapshot type is not widened to carry it**, because the snapshot remains the narrow store-and-diff value and bloating every stored snapshot with full manifests would tax the store for a field diffing never reads.

Dependency-pattern matching takes a compiled pattern or a string. Passing a compiled pattern is total and free; **an uncompilable string literal is a defect**, because a glob written into a call site is developer wiring rather than untrusted input. Compile once and reuse in a loop.

### DependencyGraph

A pure value class with lazily-built private edge indexes: total sync accessors, and fallible boundaries for the queries that can fail. **Cycle detection is iterative**, using an explicit stack rather than a recursive DFS, so there is no stack-overflow surface on a deep chain. Kahn's algorithm gives deterministic, lexicographically-sorted level output, made linear by the reverse-edge index the class already builds.

#### Core's Graph is adopted at two call sites, not as the substrate

Core ships a root-level `Graph` module and this package uses it — **for two derived answers only, over transient graphs built on demand.** The edge index, `hasCycle`, Kahn's algorithm, the `levels` / `sort` / `sortSubset` machinery, the public name-keyed API and the Schema contract (whose only field is `packages`) are all unchanged. There is no new dependency; `Graph` comes from `effect` itself.

**The substrate swap was evaluated and rejected.** It would replace the trivially-correct part — building two maps out of manifests — while keeping every part that is actually hard, and it would add a permanent name↔`NodeIndex` translation layer beneath an API that consumers address by package name. It would also widen this package's dependence on an exact-pinned beta surface for no stability gain. **Transient construction at the two call sites confines that exposure to code that is already failing or already rendering**, which is the whole shape of the adoption.

**`levels` stays hand-rolled, and that is a finding rather than a preference.** Core's `topo` cannot produce the parallel-wave boundaries `levels` exists to give: its walker exposes no level data, and `TopoConfig.initials` only *prioritizes* zero-in-degree nodes rather than fencing a wave. Settled against the vendored beta.107 source, so it does not need re-deriving.

Both transient graphs materialize through one helper that adds nodes in sorted-name order and each node's edges in sorted-target order, so `NodeIndex` *i* is always the *i*th sorted name and **everything derived is deterministic regardless of manifest key order.**

#### The cycle payload names the cycle, not the stall

`CyclicDependencyError.cycle` is **the sorted union of every strongly connected component with more than one member**, from core's `Graph.stronglyConnectedComponents`. It was Kahn's stalled set, which is a different thing: the stall holds every node that never cleared, *including packages merely downstream of a cycle*, so the payload named blameless packages and a consumer reading it as "break one of these edges" was pointed at edges that break nothing. A non-empty stall still signals *that* a cycle exists — it is just not the answer to *which*. Both failure paths, `levels` and `sortSubset`, carry the same payload, and the error's schema field is unchanged. Self-edges are dropped at index time, so a one-member component is never cyclic here. Two tests pin the discrimination: a downstream dependent excluded, and two independent cycles yielding the union of both.

#### toMermaid

A **total** method rendering the graph as a Mermaid `flowchart TD` through core's `Graph.toMermaid`. Node IDs are the numeric indexes and package names appear only inside quoted labels, so a scoped name never breaks Mermaid syntax — the property to keep if this is ever re-implemented.

### WorkspaceRoot, WorkspaceDiscovery, PackageManagerDetector

Three services, each with its layer in the same file.

**Root finding runs over [@effected/walker](walker.md)**, inheriting per-probe error absorption. Markers, in priority order: the pnpm workspace file, then a manifest with a workspaces field.

**Discovery** reads the packages list from whichever source the workspace uses, enumerates it, reads each manifest, and absorbs the longest-prefix file-to-package lookup.

All three ship `makeTest` / `layerTest` doubles, so **the whole discovery path stands up with no filesystem at all**. The defaults model an empty workspace, and derived methods run over the *effective* package list, so stubbing only the enumeration yields a consistent double.

**Two members deliberately die as defects rather than returning a default**: workspace info, because no honest default exists and a fabricated root path would leak into consumer path logic; and detection, where the reasoning is sharper — **a double that answered with a manager would contradict the defining property of the service it stands in for**, which is that the live detector refuses to guess. Failing typed would be the subtler mistake, because a detection error reads as a legitimate "no manager here" answer that a consumer branches on and proceeds past, never learning the test simply forgot to stub. Both wrong shapes are mutation-pinned.

### Package-manager detection

**Lockfile evidence is the primary signal** — it is what says which manager actually ran. The workspace tier checks the pnpm workspace file, then a bun lockfile *plus* a manifest field naming bun, then a yarn lockfile *plus* a manifest field naming yarn, then a workspaces field for npm. **The manifest conjunction on bun and yarn disambiguates a stray lockfile** in an npm repo.

#### The standalone and declaration tiers

Those markers answer "which manager runs this **workspace**", and most repos are not workspaces. A single-package repo was once undetectable, which is why one consumer carried *three* competing hand-rolled detections with two different silent defaults. Two tiers close it:

- **Standalone** — a pnpm or npm lockfile stands alone, because each is written by exactly one manager; bun and yarn keep the manifest conjunction. The conjunctions **mirror the workspace tier exactly** rather than inventing a looser second rule inside one service.
- **Declaration** — no lockfile at all, but a manifest field names one of the four. A fresh clone before its first install has no lockfile to read and its manifest still says plainly what is meant to run. Weaker evidence, so it is consulted last.

**Both tiers run after every workspace marker has missed, which makes the widening strictly additive**: no input that already resolved can change its answer, and a stray npm lockfile cannot turn a pnpm workspace into an npm repo. A regression test pins that ordering, because reordering the tiers is the obvious and wrong "simplification".

**The detector still refuses to guess.** Nothing matching is a typed error, never a fabricated default — and the proof that this is the right contract is that the two consumer reimplementations both invented a default here and invented *different* ones. **Choosing one is policy, not detection**, and a library that makes the choice silently guarantees some caller is wrong. A consumer wanting a default writes the fallback where a reader can see it. The error names everything it tried.

> **Open, deliberately not changed:** within the workspace tier the npm workspaces field is still consulted *before* any standalone lockfile, so a repo with both reports npm. Reordering so lockfile evidence outranks the field would be a behavior change to an already-shipped path rather than an additive one; it is recorded here rather than made silently.

#### The two fields that declare a manager

Corepack reads **both** the top-level manifest field and the dev-engines one, and they are not interchangeable — the second is a validation and fallback layer over the first, and corepack errors when they disagree. The detector implements:

- **The dev-engines name is authoritative for the NAME.** Where both are present and disagree, it wins, and the top-level field's name is not consulted as a disambiguator.
- **The top-level field is authoritative for the exact VERSION**, because it carries the integrity hash. Where both name the same manager its version wins; where it is absent, the dev-engines version supplies one.
- **A version is reported only when the field it came from names the manager actually detected.** A field naming a different manager says nothing about the detected one's version.

Both fields' versions normalize through [package-json](package-json.md)'s corepack codec, so a version carrying a hash reports the same version either field would. **A range yields no version** — a range is not a version, and corepack will not run one.

**A malformed manifest hint is ignored, never fatal**: it cannot turn a detectable workspace into a detection failure. A manifest that is *present but unreadable or unparseable* is different and fails typed, because a corrupt root manifest is a real problem rather than a missing hint.

This package's manager literal is its own. It is structurally identical to lockfiles' format literal and assigns freely to it, but they are **different concepts sharing a carrier**, and the name avoids colliding with package-json's corepack class in a consumer's import list.

### Ambient cwd is an explicit option

Root resolution is one concern, applied uniformly: every root-consuming layer takes an optional cwd, defaulting to the ambient one read **lazily at first use**, inside a suspend, so a directory change between provide and first call is honoured. **No service method reaches for the ambient cwd.** A parameterized layer factory mints a fresh reference per call — bind it to a `const` once.

### WorkspaceCatalogs and CatalogSet

`CatalogSet` is the immutable, fully-normalized catalog collection with the one resolution semantic, carrying statics for its three sources. `WorkspaceCatalogs` assembles it with pnpm's precedence and memoizes.

**The reader is PM-aware**: file presence picks the reader, with the pnpm workspace file taking the pnpm path and its absence falling to the root manifest's bun-style catalog fields. Lockfile catalogs are PM-aware too, since pnpm and bun both carry them.

**The catalog readers hard-fail by design**, because their output is load-bearing for diffing — a silently-empty read is the "every dependency looks added" bug. A present-but-malformed shape fails typed, while an absent or explicitly-null field yields empty. **The default catalog declared twice is rejected**, checked structurally so an explicitly-declared empty catalog still counts as a declaration.

**The policy contrast with detection is deliberate**: the detector *degrades gracefully* on malformed hints, because it is a heuristic with a fallback chain, while the catalog readers *hard-fail*, because their output is load-bearing.

**The release-age gate assembles off the same memoized pass.** The workspace's effective pnpm release-age gate folds the inline config keys and the hook contributions through npm's [combining vocabulary](npm.md#releaseagegate), **reusing the single memoized assembly pass** — one root discovery, one config read, one hook replay, both outputs memoized together, so config-dependency code runs exactly once. Present-but-malformed inline values **hard-fail**, the same posture as a malformed inline catalog block, because a silently-ignored gate is the "install refuses a too-young version the resolver already picked" bug. There is **deliberately no top-level convenience wrapper** — the service method is the surface.

### WorkspacesSync — the escape hatch

Two synchronous functions, positional-path-first with the ops bag second, and **the cwd is required** — the sync module reads no ambient cwd. Vitest's config-time project discovery cannot await, and the gate consumer calls exactly these two.

**It keeps no third pattern semantic**: it compiles through the same glob set and enumerates through a synchronous mirror of the same worklist, so a globstar means the same thing in both worlds.

**The platform comes from the caller.** The design rule, which binds every sync escape hatch in the kit: **the kit never imports `node:*` and never assumes POSIX — a sync surface takes the platform from its caller.** The options bag carries minimal structural filesystem and path interfaces that Node's built-ins satisfy verbatim. **Windows correctness is therefore the consumer passing a win32-appropriate path implementation**, not anything in this module — the same convention as [tsconfig-json](tsconfig-json.md#tsconfigloadersync--the-sync-facade)'s sync facade. Throwing consumer ops degrade to the documented skip semantics; nothing propagates.

**The `node-sync` subpath is the second entry point.** Hand-wiring the built-in one-liners at every adoption site is a tax the rule above imposes on the common case, and a tax paid per consumer is a tax paid wrong; this subpath supplies ready-made ops, making the Node case one import while leaving the rule intact.

**It is deliberately not re-exported from the index, and that is the whole point of it being a separate entry**: re-exporting would drag `node:*` into the main entry and therefore into every consumer — including the ones that supply their own ops precisely to avoid them. The platform binding is opt-in by import path, and the ops bind to the *running* platform, which is the correct default only for a consumer who means "Node, here."

It is the repo's first subpath export, with one consequence worth recording: **an entry point re-exports, contrary to the [no-barrel rule](../effect-standards.md#module-layout-module-per-concept)** — api-extractor models each entry as its own surface, so types appearing in this entry's declarations must be re-exported here or the build reports them as forgotten. **The rule bans barrels, not entry points.**

## Git integration

Change detection and snapshots run on [@effected/git](git.md)'s service over core's spawner contract in `R`. **Requiring a core-declared service in `R` costs a consumer nothing (R3), which is why this package owns no subprocess seam of its own.** A test provides git's own shipped double, whose unstubbed members die named, and needs no git repository on disk — hand-enumerating the whole git shape is a maintenance liability that every growth of that service breaks.

**Change detection** computes a committed range and optionally folds in working-tree changes, with a non-repository surfacing as git's typed error alongside this package's own.

### WorkspaceSnapshots

Snapshots answer "what did this workspace look like at that moment", at a ref or in the worktree. The snapshot value class carries the package list, the catalog set and an importer-version index, with lazily-built instance-cached private indexes **outside** the schema — the `DependencyGraph` precedent. **It is serializable by construction.**

Its resolve method answers "what did this specifier mean HERE", against this snapshot's own package versions and catalog set, classifying specifiers through [npm](npm.md)'s vocabulary. Beyond that, **a snapshot hands back layers implementing npm's resolver contracts against itself**, so anything written to the contracts can run "as of" a ref.

**Reading at a ref requires no checkout.** Four properties are load-bearing:

- **Workspace globs fall back to the root manifest's field when the pnpm file is absent at that ref.** Without this a bun or npm workspace collapses to the root package alone, and a consumer diffing two snapshots sees every declared dependency as newly added, with no error. Named regression test.
- **Package directories come from the compiled glob set matched against tree entries**, which is the at-ref discovery [glob.md](glob.md) records.
- **A path absent at the ref is skipped, never an error.**
- **The root manifest's inline bun catalogs are read unconditionally**, not gated on a bun lockfile's presence — gating them reintroduces the "every dependency looks added" bug for a bun repo with inline catalogs but a not-yet-committed lockfile. Parity-tested against the worktree read.

**The worktree read is the one shared read path** between worktree snapshots and catalog assembly; there is no second manifest or lockfile read for the worktree.

Caching is per root-and-ref with invalidate-on-non-success. The composite key is **NUL-separated**, since a NUL can appear in neither a path nor a ref so the key cannot collide — and it is spelled as the **escape** rather than a literal NUL byte, because a literal one makes `file` classify the module as binary and grep silently skip it. A source file that greps report as absent is a maintenance hazard out of all proportion to the byte. The two error unions stay narrow, and each excludes what its path never does: the at-ref one never enumerates the live filesystem, and the worktree one never invokes git.

#### The at/worktree hook-catalog asymmetry

**Reading at a ref never replays config-dependency hooks** — it reads inline catalogs plus the lockfile at that ref only. So under the hook-replaying layer, an at-ref snapshot and a worktree snapshot can disagree on hook-injected *catalog sets*. **This is deliberate: an at-ref read must not execute historical config-dependency code.**

**The importer-version fallback closes the gap for resolution** without touching that asymmetry. A hook-injected catalog is recorded in no committed catalog source, so a peer declared against such a catalog resolved to nothing on *both* sides of a diff and a real version bump produced no row and no changeset. When the catalog set cannot answer a catalog specifier, resolution now falls back to the version that ref's **own lockfile importer entry** recorded.

The rejected alternatives matter more than the accepted one:

- **Rejected — replay the ref's pinned config dependency.** Network fetch plus arbitrary historical code execution per ref, and impossible for an at-ref read regardless, since it reads without a checkout. Switching the default to the hook-replaying layer fixes only the worktree side and manufactures a bogus specifier-to-version row on every run.
- **Rejected — warn and emit no row.** Leaves the changeset missing, which is the reported defect.
- **Accepted — the lockfile importer fallback.** Both lockfiles are committed, so both read paths answer identically with no hook replay and no network. Scoped to catalog specifiers only; a plain range is already its own answer.

Two properties are load-bearing and easy to break: **the join is by dependency name across every field**, because pnpm writes a peer into the importer block only when it is also installed, so a peer's concrete version can sit on a different row than expected; and **recorded versions must be normalized**, because lockfiles stores the importer version verbatim including pnpm's peer suffix, which unstripped renders the whole parenthesized chain as a version.

**Workspace-wide resolution answers only when every importer recording that dependency agrees** — divergence is `None`, never a guess. The importer-scoped form is the precise variant for callers holding a package's relative path, and the live index comes off the **same** memoized read, keeping the one-shared-read-path rule intact.

## ConfigDependencyHooks — the opt-in replay seam

A contract service with three layers: an in-process one that dynamically imports each config dependency's pnpmfile and replays its config hooks over the inline-catalog seed, a [subprocess twin](#layersubprocess--the-same-replay-where-a-bundler-cannot-reach-it), and a no-execution stand-in.

- **Opt-in by layer choice.** The default composites wire the no-op — they **never** execute config-dependency code. Opting in is an explicit composite.
- **Assembly precedence** is lockfile < inline < hook-injected, merged per-dependency within a catalog, with the hooks seeded by the inline catalogs — matching pnpm's own behavior.
- **Failure is typed, never silent.** A config dependency that fails to load or replay fails with a hooks-sourced assembly error.
- **The security guard rejects a dependency name containing a `..` path segment before building the import target**, so a malicious entry cannot escape the intended directory.

**The replay returns a structured injection, not bare catalogs**, surfacing pnpm's release-age keys alongside them. A **sibling method would re-execute config-dependency code** — the whole point of the seam is that one replay over one mutable config object yields both outputs, exactly as pnpm replays hooks.

- **Release-age keys thread last-hook-wins**, read off the one final threaded config object, matching pnpm's single-mutable-config-object behavior.
- **A malformed release-age value is tolerantly dropped**, keeping the prior threaded value. The assembly error stays reserved for a load or replay *mechanism* failure, **not a hook's returned data**.

### layerSubprocess — the same replay where a bundler cannot reach it

**In-process replay is unreachable in a bundled consumer.** The in-process layer computes its import target at runtime, and a bundler compiles a *computed* dynamic import into a context module that resolves against a build-time directory listing, so at runtime it throws a module-not-found. Every bundled GitHub Action hits this, which means the release-age gate — the reason an Action opts into hooks at all — was simply not callable there. **This layer is the same replay with every computed load moved out of the bundle graph, and the two are drop-in interchangeable.**

- **The replay program is a static string constant, passed via argv.** Static is the whole mechanism: a bundler rewrites the *program text* it can see, so the text must carry **no interpolated runtime value** — the root, the seed and the dependency names travel as arguments, never spliced into the script. The spawn uses no shell, so argv is argv.
- **Typed-semantics parity is the contract, and it is pinned by test, not by intent.** The script mirrors the in-process module exactly: the same pnpmfile extension precedence, the same missing-pnpmfile skip discriminated by the module-not-found reason **for the candidate itself** — so a module the pnpmfile *imports* going missing is a real failure, not a skip — the same hook-locator shapes, the same **synchronous** hook call, and the same tolerant threading. An integration test drives both layers against one on-disk fixture and asserts they answer identically.
- **Per-dependency error attribution crosses the process boundary.** The child prints one final JSON line naming the offending dependency and exits through the write callback so the payload flushes even if a hook left the event loop occupied. The parent decodes that envelope through a strict union with commands' [JSON-line runner](commands.md), which owns the last-line framing and its noise tolerance, so a hook's own logging is not fatal. A serialized failure maps one-to-one onto the in-process error, dependency name intact.
- **The guard runs before any spawn**, so a malicious entry never reaches a subprocess at all — strictly earlier than the in-process guard, never later.
- **Empty config dependencies spawn nothing**, so opting in costs a workspace without them zero processes.
- **Folding and normalization stay in the parent.** The child returns only the raw threaded config slice. The script cannot import kit code, and **duplicating catalog semantics into a string literal is exactly the drift this package refuses elsewhere.**
- **Transport failure is typed, never silent** — a missing runtime, an exit with no usable payload, unparseable output are all assembly errors, never a defect and never a skip that would silently drop hook-injected catalogs.

**The cost is one requirement, core's spawner**, resolved at layer-build time so the service shape is unchanged. It surfaces in `R` on the two subprocess composites and the consumer discharges it once at the edge — the same free-because-core-declared rule as the git integration.

## Error handling

The package's own `Schema.TaggedError` types carry **structured** fields; see `src/` for the field lists. Every discriminant is a `Schema.Literals` and every cause is a `Schema.Defect()`.

Errors from the dependency packages arrive and surface alongside this package's own rather than being re-wrapped: git's typed errors under change detection, lockfiles' parse error under the reader, and npm's resolution and assembly errors under the resolver layers. **The assembly error is raised here but owned by npm, and not re-exported.**

Per-method error unions stay narrow and are exported as type aliases. **`SchemaError` never escapes**: every decode boundary normalizes it into the domain error, preserving the parse detail on the cause.

## Lazy init

Layer construction is O(1) and the heavy first-call IO — root find, manager detect, read, parse — is memoized, with init errors surfacing from each method's error channel, so a test reporter that builds the layer per call site pays nothing.

**The memo is not bare `Effect.cached`.** `cached` memoizes the first `Exit`, *including an interrupt* — an init interrupted by an unrelated timeout or a racing sibling would permanently brick the layer with a cause outside its declared error channel. The init memo is therefore **success-only**, via an infinite-TTL cache with an exit hook that invalidates on any non-success. Success is computed once across sequential and concurrent observers; a failure or interrupt is retried on the next call.

## Observability

Named `Effect.fn` spans on public fallible boundaries only, uniformly. A dedicated log-annotation namespace and Debug-level-only default silence are retained. No metrics.

## Hardening

Workspaces reads a filesystem, not a hostile string — but **a filesystem is still an untrusted, potentially cyclic input**, and the package parses text.

- **The enumerator is a worklist, not a recursion**, bounded by an integer-guarded depth cap, a visited-directory budget and the prune list. A symlink cycle terminates at the depth cap.
- **Cycle detection is iterative** — an explicit stack, no stack-overflow surface. Core's `stronglyConnectedComponents`, on the cycle-error path, is stack-safe by its own construction (Kosaraju over explicit stacks, checked in the vendored source), so borrowing it added no recursion here.
- **YAML and JSON parsing fail typed.** Every `JSON.parse` is wrapped at the point it can throw.
- **Malformed input fails typed, never a defect** — asserted by flipping the channel rather than by inspection.
- **Developer wiring errors stay defects** — an uncompilable pattern literal, a fractional depth cap.

## Testing

Suite-boundary `layer(...)` blocks, never a per-test `Effect.provide`.

**The whole package tests without a platform package**: core's path layer and a real in-memory volume ([`@effected/memfs`](memfs.md), a devDependency) drive discovery, enumeration and detection, and git-dependent tests use git's own shipped double, so they need no repository on disk. The volume replaced a stub implementing the four operations this package happens to call; the tree is seeded and the three misbehaviours the suites need — an unreadable directory, an unreadable *file*, and an `exists` probe that fails with something other than `NotFound` — are injected as fault handlers that decline for every other path. Each of the three earns its place: they are exactly the cases a `orElseSucceed(() => …)` fallback would make indistinguishable from an empty directory, an empty file and genuine absence. **One integration test discovers this repository for real** — it is the test that surfaces real-world file shapes, and it is what surfaced the config-dependencies lockfile-framing shape now owned in lockfiles.

**The doubles die as defects, and the TSDoc says what that costs a caller.** An unstubbed member is **not absorbed by `Effect.catch`** or any typed-error handler. That is the point rather than an omission: code under test with a best-effort catch around its discovery or snapshot reads would otherwise make a mandatory stub look optional, taking the catch branch and passing. Only a defect-catching combinator or an exit sees it. Consumers hit this reading a green test as proof their stubs were complete, so every double's TSDoc states it.

**The suite therefore carries both postures deliberately, and the split is by what the double is for.** The *service* doubles deny by default, because an unstubbed service call is a wiring mistake the test must not survive. The *filesystem* double delegates by default, because the filesystem is not the thing under test — a deny-by-default volume would break the fixture every time the code under test grew a new call, which is what forced the old stub to keep growing members nobody had reasoned about.

Mutation-proven edges worth preserving if the suites are rewritten:

- **The enumerator**: matches landing on the first and the last candidate, a globstar target **two** levels down (the collapse regression), a depth-cap case, a prune case, and an exclusion that must actually exclude.
- **The two-entry-point traversal drift**, driving both entry points against one real tree at the depth boundary.
- **A bun or npm workspace read at a ref must not collapse to the root package alone**, and the two read paths must agree on a clean tree — which also pins the unconditional inline-catalog read.
- **The double-default catalog rejection**, checked structurally.
- **The cycle payload excludes downstream dependents**, on both `levels` and `sortSubset` — the one edge that discriminates the SCC answer from Kahn's stalled set, which agree on every graph where nothing hangs off the cycle.
- **Hook replay through the opt-in layer against a fixture pnpmfile**, with the default layer provably never loading it.
- **Subprocess and in-process replay parity** — unit coverage over commands' scripted spawner for the argv shape, the pre-spawn guard, the no-deps no-spawn case and the envelope's failure arms, plus an **integration** suite running the real child against on-disk fixtures to pin the parity properties by construction.
- **Release-age assembly**, including a malformed inline value hard-failing and a malformed hook value being tolerantly dropped.
- **TTL-cache discipline**: a failed at-ref init is retried, not memoized.

## Build

Standard per [package-setup.md](../package-setup.md). `savvy.build.ts` carries the narrow `_base` suppression for the synthesized class-factory bases; the gate is a zero-warning `dist/prod/issues.json` with only those symbols suppressed, and a zero suppressed count means the build did not run properly.

**The suppression is scoped to `_base` and nothing else**, and that boundary has proven itself: a `@public` signature once named a module-private interface, and the build reported it as a genuine forgotten export the narrow pattern correctly did **not** mask. That was real surface a consumer must construct, so it was made public rather than suppressed.
