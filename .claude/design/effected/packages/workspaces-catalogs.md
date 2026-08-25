---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - workspaces.md
  - workspaces-discovery.md
  - workspaces-peer-check.md
  - workspaces-snapshots.md
  - npm.md
  - commands.md
---

# @effected/workspaces — catalogs and the config-dependency seam

## Overview

Catalog assembly is where [@effected/workspaces](workspaces.md) turns a workspace's several declaration sources into one resolvable set, and where pnpm's config-dependency hooks are replayed to get the parts no file records. Three outputs come off one memoized pass: the catalogs themselves, the release-age gate and the peer-dependency rules [`PeerCheck`](workspaces-peer-check.md) needs.

The modules are `src/WorkspaceCatalogs.ts`, `src/internal/catalogs.ts` (**the only module that imports `@pnpm/catalogs.*`**, so the tier-3 blast radius is one file) and `src/ConfigDependencyHooks.ts`.

## WorkspaceCatalogs and CatalogSet

`CatalogSet` is the immutable, fully-normalized catalog collection with the one resolution semantic, carrying statics for its three sources. `WorkspaceCatalogs` assembles it with pnpm's precedence and memoizes.

**The reader is PM-aware**: file presence picks the reader, with the pnpm workspace file taking the pnpm path and its absence falling to the root manifest's bun-style catalog fields. Lockfile catalogs are PM-aware too, since pnpm and bun both carry them.

**The catalog readers hard-fail by design**, because their output is load-bearing for diffing — a silently-empty read is the "every dependency looks added" bug. A present-but-malformed shape fails typed, while an absent or explicitly-null field yields empty. **The default catalog declared twice is rejected**, checked structurally so an explicitly-declared empty catalog still counts as a declaration.

**The policy contrast with [detection](workspaces-discovery.md#package-manager-detection) is deliberate**: the detector *degrades gracefully* on malformed hints, because it is a heuristic with a fallback chain, while the catalog readers *hard-fail*, because their output is load-bearing.

### The release-age gate assembles off the same pass

The workspace's effective pnpm release-age gate folds the inline config keys and the hook contributions through npm's [combining vocabulary](npm.md#releaseagegate), **reusing the single memoized assembly pass** — one root discovery, one config read, one hook replay, both outputs memoized together, so config-dependency code runs exactly once. Present-but-malformed inline values **hard-fail**, the same posture as a malformed inline catalog block, because a silently-ignored gate is the "install refuses a too-young version the resolver already picked" bug. There is **deliberately no top-level convenience wrapper** — the service method is the surface.

### The effective peer-dependency rules are the third output

`WorkspaceCatalogs.peerDependencyRules()` returns the merged set — the `pnpm-workspace.yaml` block seeded through the hook replay — and it is the input [`PeerCheck`](workspaces-peer-check.md) needs to reproduce pnpm's suppression. Adding it as a sibling method rather than a second assembly is what keeps config-dependency code running exactly once; an absent block yields `NoPeerDependencyRules`, which is an assertion rather than a gap.

## ConfigDependencyHooks — the opt-in replay seam

A contract service with three layers: an in-process one that dynamically imports each config dependency's pnpmfile and replays its config hooks over the inline-catalog seed, a [subprocess twin](#layersubprocess--the-same-replay-where-a-bundler-cannot-reach-it), and a no-execution stand-in.

- **Opt-in by layer choice.** The default composites wire the no-op — they **never** execute config-dependency code. Opting in is an explicit composite.
- **Opting in must not cost the git tier.** `layerWithGit` hard-wires the no-op catalogs layer, so a consumer wanting snapshots + change detection + hook replay had to rebuild the whole service graph by hand — a copy that then rots against the composite it duplicates, which is exactly what happened downstream. `layerWithGitAndConfigDependencies` and its `…Subprocess` twin close the matrix; internally every git composite is one `withGit(core, options)` helper over a core passed as a value, so the three variants cannot drift.
- **On the git composites the subprocess variant is free.** Its extra requirement is core's `ChildProcessSpawner`, which the git tier already requires for `Git`. So unlike the git-free pair — where the R-widening is the reason the two exist separately — there is nothing to weigh here, and a bundled consumer should simply take the subprocess form.
- **Assembly precedence** is lockfile < inline < hook-injected, merged per-dependency within a catalog, with the hooks seeded by the inline catalogs — matching pnpm's own behavior.
- **Failure is typed, never silent.** A config dependency that fails to load or replay fails with a hooks-sourced assembly error.
- **The security guard rejects a dependency name containing a `..` path segment before building the import target**, so a malicious entry cannot escape the intended directory.

**The replay returns a structured injection, not bare catalogs**, and `HookInjection` carries three slices: `catalogs`, `releaseAge` and `peerDependencyRules`. A **sibling method would re-execute config-dependency code** — the whole point of the seam is that one replay over one mutable config object yields every output, exactly as pnpm replays hooks. That the third slice cost a field rather than a subsystem is the seam paying for itself.

- **Release-age keys thread last-hook-wins**, read off the one final threaded config object, matching pnpm's single-mutable-config-object behavior.
- **A malformed release-age value is tolerantly dropped**, keeping the prior threaded value. The assembly error stays reserved for a load or replay *mechanism* failure, **not a hook's returned data**.
- **Peer-dependency rules are *seeded*, not merged.** The workspace file's block goes in as the threaded config's initial value and whatever the hooks return comes back out; `NoPeerDependencyRules` is the seed when there is no block. pnpm hands its own config in and takes what comes back, so **a hook that overwrites overwrites for pnpm too — this must never be "fixed" into a kit-owned merger**, which would be a second, divergent implementation of a rule pnpm already owns. Rationale in full under [peer-dependency rules](workspaces-peer-check.md#peer-dependency-rules-pnpms-suppression-policy-seeded-not-merged).

### layerSubprocess — the same replay where a bundler cannot reach it

**In-process replay is unreachable in a bundled consumer.** The in-process layer computes its import target at runtime, and a bundler compiles a *computed* dynamic import into a context module that resolves against a build-time directory listing, so at runtime it throws a module-not-found. Every bundled GitHub Action hits this, which means the release-age gate — the reason an Action opts into hooks at all — was simply not callable there. **This layer is the same replay with every computed load moved out of the bundle graph, and the two are drop-in interchangeable.**

- **The replay program is a static string constant, passed via argv.** Static is the whole mechanism: a bundler rewrites the *program text* it can see, so the text must carry **no interpolated runtime value** — the root, the seed and the dependency names travel as arguments, never spliced into the script. The spawn uses no shell, so argv is argv.
- **Typed-semantics parity is the contract, and it is pinned by test, not by intent.** The script mirrors the in-process module exactly: the same pnpmfile extension precedence, the same missing-pnpmfile skip discriminated by the module-not-found reason **for the candidate itself** — so a module the pnpmfile *imports* going missing is a real failure, not a skip — the same hook-locator shapes, the same **synchronous** hook call, and the same tolerant threading. An integration test drives both layers against one on-disk fixture and asserts they answer identically.
- **Per-dependency error attribution crosses the process boundary.** The child prints one final JSON line naming the offending dependency and exits through the write callback so the payload flushes even if a hook left the event loop occupied. The parent decodes that envelope through a strict union with commands' [JSON-line runner](commands.md), which owns the last-line framing and its noise tolerance, so a hook's own logging is not fatal. A serialized failure maps one-to-one onto the in-process error, dependency name intact.
- **The guard runs before any spawn**, so a malicious entry never reaches a subprocess at all — strictly earlier than the in-process guard, never later.
- **Empty config dependencies spawn nothing**, so opting in costs a workspace without them zero processes.
- **Folding and normalization stay in the parent.** The child returns only the raw threaded config slice. The script cannot import kit code, and **duplicating catalog semantics into a string literal is exactly the drift this package refuses elsewhere.**
- **Transport failure is typed, never silent** — a missing runtime, an exit with no usable payload, unparseable output are all assembly errors, never a defect and never a skip that would silently drop hook-injected catalogs.

**The cost is one requirement, core's spawner**, resolved at layer-build time so the service shape is unchanged. It surfaces in `R` on the two subprocess composites and the consumer discharges it once at the edge — the same free-because-core-declared rule as [the git integration](workspaces-snapshots.md).

## Test edges

Worth preserving if the suites are rewritten: the double-default catalog rejection checked structurally; hook replay through the opt-in layer against a fixture pnpmfile, with the default layer provably never loading it; release-age assembly including a malformed inline value hard-failing and a malformed hook value being tolerantly dropped; peer-rule replay against a fixture pnpmfile that injects `peerDependencyRules`, pinning that the seeded workspace-file block survives a hook that does not touch it; and subprocess/in-process parity — unit coverage over commands' scripted spawner for the argv shape, the pre-spawn guard, the no-deps no-spawn case and the envelope's failure arms, plus an integration suite running the real child against on-disk fixtures.
