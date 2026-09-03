---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - workspaces-discovery.md
  - workspaces-graph.md
  - workspaces-catalogs.md
  - workspaces-peer-check.md
  - workspaces-snapshots.md
  - workspaces-release.md
  - lockfiles.md
  - glob.md
  - walker.md
  - npm.md
  - package-json.md
  - git.md
  - commands.md
  - memfs.md
  - schema-org.md
---

# @effected/workspaces design

## Overview

`@effected/workspaces` is the **integrated-tier** monorepo tooling package: the part of workspace management that only makes sense with a filesystem and a package manager under it. It composes the pure parsers around it — [lockfiles](lockfiles.md), [glob](glob.md), [git](git.md) — over one workspace model, and it implements two service contracts that boundary-tier packages declare but cannot fill.

Six subsystems, each documented on its own:

- **[Discovery and detection](workspaces-discovery.md)** — root finding, the `packages:` enumerator and its traversal, the located-member model, and package-manager detection.
- **[The dependency graph](workspaces-graph.md)** — the edge index, cycle detection, topological levels and where core's `Graph` is adopted.
- **[Catalogs and the config-dependency seam](workspaces-catalogs.md)** — catalog assembly, the release-age gate, the peer-rule slice, and the hook replay in-process and as a subprocess.
- **[Peer-dependency checking](workspaces-peer-check.md)** — a lockfile-only reproduction of `pnpm peers check`, with its fail-closed report.
- **[Git integration and snapshots](workspaces-snapshots.md)** — change detection, point-in-time snapshots at a ref, and the seeded-catalog seam.
- **[The release surface](workspaces-release.md)** — publishability, versioning strategy and release tags, reaching the rest only through discovery and the package model.

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

There is **no `minimatch` dependency** — dependency-pattern matching and the enumerator's glob both run on [glob](glob.md)'s vendored engine.

**Subprocess spawning lives entirely behind core's `ChildProcessSpawner` contract**, required in `R` and never backed here; there is no `node:child_process` anywhere.

Two modules touch Node built-ins, and **both are opt-in rather than on the main path**. `ConfigDependencyHooks` does an in-process dynamic import under one layer and spawns a `node` child under another ([the seam](workspaces-catalogs.md#configdependencyhooks--the-opt-in-replay-seam)) — a built-in import and a spawner requirement, not dependencies, so neither affects tier. `src/node-sync.ts` imports `node:fs` and `node:path`, but it is a **separate entry point** the index never re-exports, so nothing reaches it unless a consumer imports the subpath by name ([the escape hatch](#workspacessync--the-escape-hatch)). **The main entry stays platform-free.**

**YAML stream framing is not this package's job.** `pnpm-lock.yaml` carries a config-dependencies preamble document ahead of the real lockfile whenever the workspace uses config dependencies, and a first-document parse silently returns the preamble — an apparently empty workspace rather than a failure. [Lockfiles](lockfiles.md#document-framing-a-lockfile-is-a-yaml-stream) owns this on a deterministic rule and surfaces a typed framing error when a stream carries no lockfile document, so the reader here calls that parser directly.

## Implementing @effected/npm's resolver contracts

[@effected/npm](npm.md) defines two shape-only service contracts that [@effected/package-json](package-json.md) needs but cannot implement, and ships only no-op layers. **This package implements them**, because catalog resolution needs the workspace config plus the lockfile, and workspace-version resolution needs the discovered package list, both of which live here. The implementations are exported as layers over this package's own services, plus a merged convenience layer.

Provide either alongside a manifest resolve and a package.json's `catalog:` / `workspace:` specifiers resolve for real instead of answering `None`. **The contracts' convention holds exactly**: an *unmatched* name is `None`, and the error channel is reserved for a failure of the resolution *mechanism*.

**The assembly error is npm's, and it passes through typed.** `CatalogAssemblyError` lives in npm beside the contract that names it, so an unreadable or malformed catalog source passes through as that typed error rather than being folded into a resolution error's defect cause, which used to force consumers to `_tag`-sniff `unknown`. Only the remaining mechanism failure — an unfindable workspace root — is wrapped. This package imports the error back from npm and deliberately does **not** re-export it.

Two conveniences sit on top:

- **`Workspaces.resolverLayer(options?)`** pre-wires the resolvers over the config-dependency path, so the two contracts need only a platform from the consumer. It is **deliberately a parameterized layer function, and the fresh layer per call is the feature**: layers memoize by reference, so each call mints an unmemoized layer whose root discovery re-runs, including a per-call ambient-cwd read when none is given. A build tool that changes directory between manifests gets a correct re-discovery each time precisely because nothing is shared; a consumer that wants sharing binds one call's result to a `const`.
- **`Workspaces.resolveManifest`** is the one-shot path, providing a fresh resolver layer per call. Consumers processing many manifests check npm's pure `needsResolution` predicate first and skip the call — and catalog assembly — entirely when nothing needs resolving.

## Implementing @effected/commands' LocalExec contract

The second inverted contract this package fills, on the same reasoning. [@effected/commands](commands.md) needs package-manager detection and workspace-root resolution for its tool discovery, and both live here — but a direct commands→workspaces edge would make that **boundary-tier** package integrated, and through the npm→commands edge would drag npm, lockfiles (pure!) and package-json up a tier with it. So commands declares the narrow contract and this package ships the layer.

**The R2 direction is what makes this safe.** The commands edge is a dependency on a *boundary* package, and [R2](../effect-standards.md#dependency-policy) taxes only tier-3 edges — so taking it changes nothing about this package's tier and costs a consumer nothing extra. **The inversion exists to protect commands and its dependents, not this package.**

**The argv knowledge is not duplicated.** Commands owns the one table of the four managers' exec, dlx and script prefixes; this layer detects *which* manager owns the directory and asks commands what that manager's argv looks like. The tests assert against that same static rather than a copy, so the two packages cannot silently drift — this layer destructures whatever the table returns.

**`None` is success, and the boundary is where the value is.** The contract reserves its typed error for **mechanism** failure, so:

| Condition | Answer | Why |
| --- | --- | --- |
| No workspace root above the cwd | `None` | "No project-local way to run tools here" is an ordinary fact; a bare directory should not have to catch an error to learn it. |
| Detection found no evidence | `None` | The detector [refused to guess](workspaces-discovery.md#the-standalone-and-declaration-tiers). No identifiable launcher is the same honest absence. |
| A manifest that cannot be read or parsed | typed error | A manifest that exists but is broken is **not absent**. Reporting `None` would tell a caller "no local tooling" when the truth is "your repository is damaged". |

That split falls straight out of the detector's own error taxonomy, which is why it is stated rather than invented. All three rows are mutation-pinned in both directions.

The resulting context's directory is the resolved **workspace root**, not the caller's cwd: a project-local launcher has to run where the workspace is, and resolving that root is the reason this layer exists rather than a bare one in commands.

**A consumer with no monorepo never needs this layer and therefore never installs this package** — the no-op and fixed-manager forms are one-liners in commands. That asymmetry is the entire payoff of the inversion.

## Module layout

Module-per-concept; see `src/` for the full list. The placements that are decisions rather than mechanics:

- **`internal/catalogs.ts` is the only module that imports `@pnpm/catalogs.*`** — the tier-3 blast radius is one file.
- **`ReleaseTag.ts` is a leaf importing nothing else here**, which is what keeps the tag vocabulary pure.
- **`src/node-sync.ts` is a second package entry point**, not a module of the first.
- **`CatalogAssemblyError` is not this package's module.** It lives in [npm](npm.md) beside the contract that names it; three modules here import it, and it is not re-exported.

**Sorting and file-to-package lookup are not services**: sorting is methods on the [`DependencyGraph`](workspaces-graph.md) value class, and file resolution folds into discovery.

## WorkspacesSync — the escape hatch

Two synchronous functions in `src/WorkspacesSync.ts`, positional-path-first with the ops bag second, and **the cwd is required** — the sync module reads no ambient cwd. Vitest's config-time project discovery cannot await, and the gate consumer calls exactly these two.

**It keeps no third pattern semantic**: it compiles through the same glob set and enumerates through a synchronous mirror of [the same worklist](workspaces-discovery.md#one-traversal-two-entry-points), so a globstar means the same thing in both worlds.

**The platform comes from the caller.** The design rule, which binds every sync escape hatch in the kit: **the kit never imports `node:*` and never assumes POSIX — a sync surface takes the platform from its caller.** The options bag carries minimal structural filesystem and path interfaces that Node's built-ins satisfy verbatim. **Windows correctness is therefore the consumer passing a win32-appropriate path implementation**, not anything in this module — the same convention as [tsconfig-json](tsconfig-json.md#tsconfigloadersync--the-sync-facade)'s sync facade. Throwing consumer ops degrade to the documented skip semantics; nothing propagates.

**The port has one optional member, and it is a cost optimization only.** `readDirectoryWithTypes` reports a directory's entries with their types already resolved, collapsing the enumerator's `readDirectory` plus one `isDirectory` per entry — the readdir-then-stat-per-entry shape, a syscall per file on a large workspace — into a single `readdirSync(path, { withFileTypes: true })`. Omitting it falls back to the four required operations with identical results, so nothing about it is a behavior switch, and adding it broke no consumer because it is optional.

**The fast path re-resolves symbolic links, and that is the whole subtlety.** A `Dirent` describes the entry *itself*, so a link pointing at a directory reports `isDirectory: false` where the `stat`-based slow path — which resolves the link — calls the same entry a directory. A naive fast path that trusted the dirent would silently drop every symlinked package directory while agreeing with the slow path on every tree that has none. Enumeration therefore takes `isDirectory` from the dirent only for non-links and re-resolves links through the port's `isDirectory`. The flag is *reported* rather than resolved away because which behavior is correct is domain-dependent: enumeration follows links since a symlinked package is still a package, while a consumer walking test files must not — in a pnpm workspace `node_modules` is a farm of links into the content-addressed store, and following them walks the store or hits a cycle.

**A volume can supply the port.** [`@effected/memfs`](memfs.md#the-sync-filesystem-port)'s `syncFileSystem(volume)` satisfies `SyncFileSystem` **structurally** — neither package imports the other, which is what memfs's zero-edges law requires — so a consumer can resolve a workspace root and its packages entirely inside an in-memory volume, with no tmpdir and no disk. That is the sanctioned way to test code sitting on these two functions.

**The `node-sync` subpath is the second entry point.** Hand-wiring the built-in one-liners at every adoption site is a tax the rule above imposes on the common case, and a tax paid per consumer is a tax paid wrong; this subpath supplies ready-made ops, making the Node case one import while leaving the rule intact.

**It is deliberately not re-exported from the index, and that is the whole point of it being a separate entry**: re-exporting would drag `node:*` into the main entry and therefore into every consumer — including the ones that supply their own ops precisely to avoid them. The platform binding is opt-in by import path, and the ops bind to the *running* platform, which is the correct default only for a consumer who means "Node, here."

One consequence of a subpath export is worth recording: **an entry point re-exports, contrary to the [no-barrel rule](../effect-standards.md#module-layout-module-per-concept)** — api-extractor models each entry as its own surface, so types appearing in this entry's declarations must be re-exported here or the build reports them as forgotten. **The rule bans barrels, not entry points.** The general wiring is in [package-setup.md](../package-setup.md#a-second-published-entrypoint); [schema-org](schema-org.md#module-layout-and-the-two-entrypoints)'s `./validate` is the other instance.

The mutation-proven edge worth keeping: **the dirent fast path against the four-operation fallback**, over a tree whose package directory is a **symlink** — the one shape that discriminates them — with a positive control asserting the symlinked package is found at all, so "the two agree" cannot be satisfied by both finding nothing. Plus a throwing fast path degrading to the documented skip rather than propagating.

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

Suite-boundary `layer(...)` blocks, never a per-test `Effect.provide`. The edges each subsystem's suites must keep are recorded in that subsystem's doc.

**The whole package tests without a platform package**: core's path layer and a real in-memory volume ([`@effected/memfs`](memfs.md), a devDependency) drive discovery, enumeration and detection, and git-dependent tests use git's own shipped double, so they need no repository on disk. The volume replaced a stub implementing the four operations this package happens to call; the tree is seeded and the three misbehaviours the suites need — an unreadable directory, an unreadable *file*, and an `exists` probe that fails with something other than `NotFound` — are injected as fault handlers that decline for every other path. Each of the three earns its place: they are exactly the cases an `orElseSucceed(() => …)` fallback would make indistinguishable from an empty directory, an empty file and genuine absence. **One integration test discovers this repository for real** — it is the test that surfaces real-world file shapes, and it is what surfaced the config-dependencies lockfile-framing shape now owned in lockfiles.

**The doubles die as defects, and the TSDoc says what that costs a caller.** An unstubbed member is **not absorbed by `Effect.catch`** or any typed-error handler. That is the point rather than an omission: code under test with a best-effort catch around its discovery or snapshot reads would otherwise make a mandatory stub look optional, taking the catch branch and passing. Only a defect-catching combinator or an exit sees it. Consumers hit this reading a green test as proof their stubs were complete, so every double's TSDoc states it.

**The suite therefore carries both postures deliberately, and the split is by what the double is for.** The *service* doubles deny by default, because an unstubbed service call is a wiring mistake the test must not survive. The *filesystem* double delegates by default, because the filesystem is not the thing under test — a deny-by-default volume would break the fixture every time the code under test grew a new call, which is what forced the old stub to keep growing members nobody had reasoned about.

## Build

Standard per [package-setup.md](../package-setup.md). `savvy.build.ts` carries the narrow `_base` suppression for the synthesized class-factory bases; the gate is a zero-warning `dist/prod/issues.json` with only those symbols suppressed, and a zero suppressed count means the build did not run properly.

**The suppression is scoped to `_base` and nothing else**, and that boundary has proven itself: a `@public` signature once named a module-private interface, and the build reported it as a genuine forgotten export the narrow pattern correctly did **not** mask. That was real surface a consumer must construct, so it was made public rather than suppressed.
