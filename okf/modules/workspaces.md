---
type: Module
title: "@effected/workspaces: monorepo tooling"
description: The integrated-tier package that finds a workspace root, enumerates its packages, walks the dependency graph, detects the package manager, assembles pnpm catalogs, checks peer dependencies, and reads git-scoped snapshots.
status: stable
kind: package
resource: ../../packages/workspaces
tags:
  - architecture
  - bundle
sources:
  - id: package-json
    resource: ../../packages/workspaces/package.json
  - id: index-ts
    resource: ../../packages/workspaces/src/index.ts
  - id: internal-catalogs-ts
    resource: ../../packages/workspaces/src/internal/catalogs.ts
  - id: node-sync-ts
    resource: ../../packages/workspaces/src/node-sync.ts
  - id: workspaces-sync-ts
    resource: ../../packages/workspaces/src/WorkspacesSync.ts
  - id: savvy-build-ts
    resource: ../../packages/workspaces/savvy.build.ts
  - id: workspaces-ts
    resource: ../../packages/workspaces/src/Workspaces.ts
  - id: testing-ts
    resource: ../../packages/workspaces/src/testing.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-25T20:38:38Z
  body_sha256: 7e6646f0e90eb11c8ff92c971de002cfd14d352b0397d2d0b4962d61001bf7b7
---

# @effected/workspaces: monorepo tooling

`@effected/workspaces` is the part of monorepo tooling that only makes sense
with a filesystem and a package manager under it: root discovery, the
`packages:` enumerator, the dependency graph, package-manager detection,
pnpm catalog assembly, peer-dependency checking, and git-scoped snapshots. It
composes the pure parsers around it — [lockfiles](../interfaces/workspaces-discovery.md),
`@effected/glob`, `@effected/git` — over one workspace model, and it fills
two service contracts that boundary-tier packages declare but cannot
implement themselves.

## Tier and dependency posture

The package is **integrated tier**, and the `@pnpm/catalogs.*` quartet
(`@pnpm/catalogs.config`, `@pnpm/catalogs.protocol-parser`,
`@pnpm/catalogs.resolver`, `@pnpm/catalogs.types`) is what makes it so: those
packages *are* pnpm's catalog semantics, versioned to pnpm majors, and
reimplementing them would mean owning a moving external spec with no
oracle.[^package-json] The blast radius of that tier-3 dependency is confined
to a single file — `src/internal/catalogs.ts` is the only module in the
package that imports `@pnpm/catalogs.*`.[^internal-catalogs-ts]

The other dependency worth naming is git: `ChangeDetector` and the snapshot
service run entirely on `@effected/git`'s typed service over core's
`ChildProcessSpawner` contract, which is the one boundary edge the package
takes on. There is no `minimatch` dependency and no `node:child_process`
import anywhere in the main module graph — dependency-pattern matching and
the `packages:` enumerator both run on `@effected/glob`'s vendored matching
engine, and subprocess spawning lives entirely behind core's spawner
contract.[^package-json]

Kit dependencies are `workspace:^`: `@effected/commands`, `@effected/git`,
`@effected/glob`, `@effected/lockfiles`, `@effected/npm`,
`@effected/package-json`, `@effected/semver`, `@effected/walker`, and
`@effected/yaml` for `pnpm-workspace.yaml`; `effect` is a
peer.[^package-json]

## Implementing @effected/npm's resolver contracts

`@effected/npm` defines two shape-only service contracts —
`CatalogResolver` and `WorkspaceResolver` — that `@effected/package-json`
needs but cannot implement itself, shipping only no-op layers. This package
implements them, because catalog resolution needs the workspace config plus
the lockfile and workspace-version resolution needs the discovered package
list, both of which live here. The contracts' convention holds exactly: an
*unmatched* name answers `None`, and the error channel is reserved for a
failure of the resolution mechanism. A version-less workspace member is
neither — `WorkspaceResolver.versionOf` fails typed for a matched member
that declares no `version`, because answering `None` for a version-less
member would read downstream as "not a workspace package" for something the
workspace plainly contains (see
[the discovery interface](../interfaces/workspaces-discovery.md)).

`CatalogAssemblyError` is raised here but owned by `@effected/npm`, imported
back rather than redeclared, and deliberately not re-exported from this
package's entry point — an unreadable or malformed catalog source passes
through typed as that error, and only an unfindable workspace root wraps
into this package's own `DependencyResolutionError`.

Two conveniences sit on top: `Workspaces.resolverLayer(options?)` pre-wires
both resolvers over the config-dependency path, and is deliberately a
parameterized layer function whose fresh, unmemoized layer per call is the
feature — layers memoize by reference, so each call re-runs root discovery
(including a per-call ambient-cwd read when none is given); a consumer that
wants sharing binds one call's result to a `const`.
`Workspaces.resolveManifest` is the one-shot path over a fresh resolver
layer per call, and consumers processing many manifests should check
`@effected/npm`'s pure `needsResolution` predicate first to skip catalog
assembly entirely when nothing needs resolving.[^workspaces-ts]

## Implementing @effected/commands' LocalExec contract

The second inverted contract this package fills is `@effected/commands`'
`LocalExec`, on the same reasoning: `@effected/commands` needs
package-manager detection and workspace-root resolution for its tool
discovery, and both live here, but a direct `commands` → `workspaces` edge
would make `commands` — a boundary-tier package — integrated, and through
the `npm` → `commands` edge would drag `npm`, `lockfiles` (pure) and
`package-json` up a tier with it. See
[the contract-inversion decision](../decisions/contract-inversion-default.md)
for the program-wide rule this follows.

`localExecLayer` reserves `None` for an ordinary absence and a typed error
for a broken manifest only: no workspace root above the cwd answers `None`
("no project-local way to run tools here" is an ordinary fact); detection
finding no evidence answers `None` (the detector refused to guess, which is
the same honest absence); and a manifest that exists but cannot be read or
parsed is a typed error, because that is not absence but damage. All three
rows are mutation-pinned in both directions in the package's own test suite.
The resulting context's directory is the resolved **workspace root**, never
the caller's cwd, and every argv prefix comes from `@effected/commands`'
own table — this layer never hard-codes an exec, dlx, or script-runner
prefix. A consumer with no monorepo never needs this layer and therefore
never installs this package, which is the entire payoff of the inversion.

## Module layout

Module-per-concept; the placements that are decisions rather than
mechanics:

- `src/internal/catalogs.ts` is the only module that imports
  `@pnpm/catalogs.*`.[^internal-catalogs-ts]
- `src/ReleaseTag.ts` is a leaf importing nothing else in the package, which
  is what keeps the release-tag vocabulary pure.
- `src/node-sync.ts` is a second package entry point, not a module of the
  first, and `src/testing.ts` is a third. Only `src/index.ts`,
  `src/node-sync.ts` and `src/testing.ts` re-export.
- `CatalogAssemblyError` is not this package's module; it lives in
  `@effected/npm` beside the contract that names it.
- Lockfile framing is not this package's job. `@effected/lockfiles` owns
  pnpm's multi-document `pnpm-lock.yaml`, and `LockfileReader` only calls
  `Lockfile.parse` and resolves pnpm importer paths to names; no
  richest-document-wins or other framing workaround belongs here.
- Sorting and file-to-package lookup are not services: sorting is methods on
  the `DependencyGraph` value class (see
  [the graph interface](../interfaces/workspaces-graph.md)), and file
  resolution folds into discovery.

## Public surface

`src/index.ts` is the only re-exporting entry point.[^index-ts] The seven
subsystems each ship their own contract, covered as their own Interface
concepts: [discovery and detection](../interfaces/workspaces-discovery.md),
[the dependency graph](../interfaces/workspaces-graph.md),
[catalogs and the config-dependency seam](../interfaces/workspaces-catalogs.md),
[peer-dependency checking](../interfaces/workspaces-peer-check.md),
[duplicate-copy checking](../interfaces/workspaces-duplicate-check.md),
[git integration and snapshots](../interfaces/workspaces-snapshots.md), and
[the release surface](../interfaces/workspaces-release.md).

`Workspaces.ts` exposes the composites (`layer`, `layerWithConfigDependencies`,
`layerWithConfigDependenciesSubprocess`, `layerWithGit`,
`layerWithGitAndConfigDependencies`,
`layerWithGitAndConfigDependenciesSubprocess`, and `layerWithGitAndHooks` over a caller-supplied hooks layer), the one-call manifest path
(`resolverLayer`, `resolveManifest`), and `localExecLayer`. The git
composites take `WorkspacesGitOptions` — `WorkspacesOptions` plus
`WorkspaceSnapshotsOptions` — which is how a layer-level `seedCatalogs`
reaches `at(ref)` without hand-composing the graph.[^workspaces-ts]
`Workspaces` is a
static class with a private constructor rather than an `as const` namespace
object, because an `as const` object's member types are inferred in the
built `.d.ts` and lose their TSDoc, while `static readonly` members keep it
with unaffected call syntax.

## The `./testing` subpath

`@effected/workspaces/testing` is the third entry point, beside `.` and
`./node-sync`. It holds three repo-shape checks consumer repositories used to
hand-roll, each a static class with a private
constructor:[^testing-ts]

- `SourceBoundary` (with `Offence`, `OffenceRule`, `SourceScan`,
  `BoundaryRule`, `BoundaryFixture`, `ReferenceOptions` and `ScanOptions`): a
  lexer-backed scanner that flags a `process` read, a forbidden import, a
  `stdout.write`, any console reference (`console`) or one that can reach
  stdout (`console-stdout`), with pure `check` and `referencesProcess`, a
  `scan` over `FileSystem` with whole-file `allow` and per-rule `allowRules`
  exemptions, and shipped positive controls behind `verifyFixtures`.
- `WorkspaceLayering` (with `LayerPolicy`, `LayerPolicyError`, `LayerEdge`,
  `LayeringGraph` and `LayeringReport`): a pure check of a per-field edge
  graph against a committed layer policy, plus `checkWorkspace` over
  discovery.
- `PackedInstall` (with `PackedInstallError`, `PackedInstallResult`,
  `InstalledConsumer`, `PackSource`, `PackedInstallOptions`,
  `PackedInstallClosureOptions`, `PackedInstallBudget`, `BinCommandOptions`
  and `RunBinOptions`): packs a carrier, its closure and any `overrides`,
  then installs it into a scratch consumer under every available package
  manager; `closure` names what a run will pack without packing it.

The contracts are
[the repo-shape checks interface](../interfaces/workspaces-repo-shape-checks.md).
Why they live here is
[D5](../decisions/repo-shape-checks-live-in-workspaces-testing.md); why the
default pack source is the prod npm directory is
[the pack-source decision](../decisions/packed-install-pack-source.md); and
why this repository's own layering check reads runtime fields only is
[the runtime-edge decision](../decisions/kit-layering-checks-runtime-edges.md).

`src/index.ts` never re-exports `./testing`, and the reachability test in
`__test__/entrypoints.test.ts` pins that. No new dependency came with it: the
subpath uses `@effected/glob`, `@effected/npm`, `@effected/commands`,
`@effected/yaml` and core `effect` only. None of its modules reads `process`, imports `node:` or writes
to the console; every `process` value arrives as a parameter from the
consumer's test file, and the package's self-scan enforces it with the
scanner it ships.

The built modules' raw byte sizes, measured on 2026-09-24 with `wc -c` over
`dist/prod/npm/pkg` after a clean `pnpm build --filter @effected/workspaces`
(unminified ESM, TSDoc comments kept); the two `PackedInstall` rows were
re-measured the same way on 2026-09-25, after overrides, `closure` and
`command` landed:

| Module | Bytes |
| --- | --- |
| `testing.js` | 1,151 |
| `SourceBoundary.js` | 18,272 |
| `LayerPolicy.js` | 5,576 |
| `WorkspaceLayering.js` | 7,855 |
| `PackedInstall.js` | 30,796 |
| `internal/sourceText.js` | 10,369 |
| `internal/packedInstallPlan.js` | 9,621 |
| `internal/dependencyFields.js` | 496 |

`PackedInstall.js` imports `@effected/commands`, `@effected/yaml`, `effect`,
`effect/unstable/process` and three local modules. The external imports,
`WorkspaceDiscovery.js` and `PackageManagerName.js` are already loaded by `.`;
`internal/packedInstallPlan.js` is `./testing`-only, and
`__test__/entrypoints.test.ts` asserts `.` never reaches it. So D5's "a
consumer that only needs the pure check must not pay to load `PackedInstall`"
is honoured at the `.`/`./testing` boundary rather than inside `./testing`.

### Spec amendments (phase 3)

The front-end kit design's §8 was amended during phase 3. The amendments
continue phase 2's A1–A10:

- **B1**: `WorkspaceLayering.check` takes a `LayeringGraph` of names and
  per-field edges instead of a node list, because `DependencyGraph` merges
  the four fields (`DependencyGraph.ts:114-120`).
- **B2**: `LayerPolicy` gains `decode` and `load` and a `LayerPolicyError`
  (`read`, `json`, `decode`), because `SchemaError` never escapes a decode
  boundary (this concept's "Error handling"). Decoding is strict (reversed
  from the original B2 leniency in the final review): an unknown key fails
  `decode` naming it, `$schema` is always accepted, and a file's own keys
  (systems' `harness`) pass through `allowKeys`.
- **B3**: `LayeringReport.offenders` carries `{ edge, reason }` over five
  reasons, and edges are drawn by dependency name, not protocol
  (`WorkspaceLayering.ts`).
- **B4**: `SourceBoundary.scan` returns a `SourceScan` of `files`, `allowed`,
  `offences` and `waived` (the offences an `allowRules` glob waived), so an
  empty or mistyped root, or a stale waiver, cannot read as clean, and
  gains `check`, `fixtures` and `verifyFixtures` (`SourceBoundary.ts`).
- **B5**: `referencesProcess` never counts strings, template text, regex
  bodies, comments or other objects' members, always counts `globalThis`,
  spread and computed access, exempts `process.env.__PACKAGE_VERSION__`, and
  documents its misses (`SourceBoundary.ts`).
- **B6**: `PackedInstall` reuses neither `PackagePublish.pack`, which writes
  into the package directory (`PackagePublish.ts:317`), nor
  `PackageTarball`, which fetches a published version
  (`PackageTarball.ts:75`).
- **B7**: `run` returns `PackedInstallResult { consumers, unavailable,
  tarballs }` with `require`, `consumerDependencies` and `installTimeout`,
  because a bare consumer array cannot show an all-skipped run
  (`PackedInstall.ts`).
- **B8**: `PackedInstall` is POSIX-only and fails `UnsupportedPlatform`
  otherwise, because `.bin` entries are shell shims and the manifest read
  shells out to `tar`.
- **B9**: the design's forbidden edges are runtime edges, so test-only
  devDependencies may point up
  ([the runtime-edge decision](../decisions/kit-layering-checks-runtime-edges.md)).
- **B10**: D5's cost clause is honoured at the `.`/`./testing` boundary, as
  the byte record and import list above show (`__test__/entrypoints.test.ts`).
- **B11**: `packFrom` defaults to probe P3's outcome, `{ directory:
  "dist/prod/npm/pkg" }`
  ([the pack-source decision](../decisions/packed-install-pack-source.md)).

## WorkspacesSync — the escape hatch

Two synchronous functions in `src/WorkspacesSync.ts`
(`findWorkspaceRootSync`, `getWorkspacePackagesSync`), positional-path-first
with an options bag second, and the cwd is required — the module reads no
ambient cwd, because Vitest's config-time project discovery cannot
await.[^workspaces-sync-ts] Both entry points drive the same worklist-based
traversal state machine (`src/internal/traverse.ts`) that the Effect
enumerator uses, so a globstar means the same thing in both worlds; the one
deliberate divergence is at a bound, where the Effect path fails typed and
the sync path truncates.

`getWorkspacePackagesSync` is total — it has no error channel to fail a bad
manifest through — so a member it cannot use is instead reported through an
optional `onSkip` callback as a `WorkspaceDiscoverySkip`, naming the path and
the same `kind` vocabulary a typed `WorkspaceDiscoveryError` would use. A
caller that omits `onSkip` gets the old behavior back exactly: the skip is
dropped, nothing is logged in its place. Before this existed, a fixture with
one unusable manifest enumerated as a plausible empty array, indistinguishable
from "no workspaces configured" — the failure mode issue #605 named.

The design rule binding every sync escape hatch in the kit is that the
package never imports `node:*` on its main path and never assumes POSIX — a
sync surface takes its platform from its caller. The options bag carries
minimal structural filesystem and path interfaces that Node's built-ins
satisfy verbatim, so Windows correctness is the consumer's responsibility:
passing a win32-appropriate path implementation. A volume from
`@effected/memfs` satisfies `SyncFileSystem` structurally, with neither
package importing the other, which is the sanctioned way to test code
sitting on these two functions with no tmpdir and no disk.

`readDirectoryWithTypes` is one optional port member, a pure cost
optimization collapsing a readdir-then-stat-per-entry shape into a single
`readdirSync(path, { withFileTypes: true })`; omitting it falls back to the
four required operations with identical results.[^workspaces-sync-ts] The
fast path re-resolves symbolic links through the port's `isDirectory`
rather than trusting the `Dirent`, because a `Dirent` describes the entry
itself and a link pointing at a directory would otherwise report
`isDirectory: false`, silently dropping every symlinked package directory —
enumeration follows links since a symlinked package is still a package,
while other walkers in the kit must not, because in a pnpm workspace
`node_modules` is a farm of links into the content-addressed store.

The `./node-sync` subpath is the package's second entry point, published
only there and never re-exported from `.` — re-exporting would drag
`node:fs` and `node:path` into every consumer, including the ones supplying
their own ops precisely to avoid them.[^node-sync-ts] See
[the second-entrypoint decision](../decisions/second-published-entrypoint.md)
for the general rule this package's split follows, and
[the escape-hatch decision](../decisions/workspaces-sync-facade-escape-hatch.md)
for why the whole `*Sync` family is named and shaped this way.

## Error handling

The package's own `Schema.TaggedError` types carry structured fields, with
every discriminant a `Schema.Literals` and every cause a `Schema.Defect()`.
Errors from dependency packages arrive and surface alongside this package's
own rather than being re-wrapped: git's typed errors under change detection,
lockfiles' parse error under the reader, and npm's resolution and assembly
errors under the resolver layers. Per-method error unions stay narrow and
are exported as type aliases; `SchemaError` never escapes a decode boundary
— it is always normalized into the domain error with the parse detail
preserved on the cause.

## Lazy init

Layer construction is O(1); the heavy first-call IO (root find, manager
detect, read, parse) is memoized, with init errors surfacing from each
method's own error channel, so a test reporter that builds the layer per
call site pays nothing. The memo is not bare `Effect.cached`, because
`cached` memoizes the first `Exit` including an interrupt — an init
interrupted by an unrelated timeout or a racing sibling would permanently
poison the layer with a cause outside its declared error channel. The init
memo is success-only, via an infinite-TTL cache with an exit hook that
invalidates on any non-success: success is computed once across sequential
and concurrent observers, and a failure or interrupt retries on the next
call.

## Observability

Named `Effect.fn` spans sit on public fallible boundaries only, uniformly,
with a dedicated log-annotation namespace and Debug-level-only default
silence. There are no metrics.

## Hardening

The package reads a filesystem, not a hostile string, but a filesystem is
still an untrusted, potentially cyclic input, and the package parses text:

- The enumerator is a worklist, not a recursion, bounded by an
  integer-guarded depth cap, a visited-directory budget, and the prune
  list; a symlink cycle terminates at the depth cap.
- Cycle detection is iterative — an explicit stack, no stack-overflow
  surface — using core's `stronglyConnectedComponents`, which is stack-safe
  by its own construction (Kosaraju over explicit stacks).
- YAML and JSON parsing fail typed: every `JSON.parse` is wrapped at the
  point it can throw.
- Malformed input fails typed, never a defect.
- Developer wiring errors (an uncompilable pattern literal, a fractional
  depth cap) stay defects.

## Testing

Suites use suite-boundary `layer(...)` blocks, never a per-test
`Effect.provide`; a suite-boundary layer cannot vary per test, so each
distinct fixture tree gets its own `layer(...)` block. The whole package
tests without a platform package: core's path layer and a real in-memory
volume from `@effected/memfs` (a devDependency) drive discovery,
enumeration, and detection — the fixture helper seeds a volume from a
`Tree` record and injects its misbehaviours as faults — and git-dependent
tests use `@effected/git`'s own shipped double, so nothing needs a
repository on disk. Fixtures are chosen to discriminate: the per-root
discovery tests stand up two workspaces that disagree on membership and
versions, because roots that agree cannot tell a re-read from a re-root,
and the `pnpm peers check` oracle is committed output, never a live
subprocess (see [peer-dependency checking](../interfaces/workspaces-peer-check.md#the-differential-oracle)). One integration test discovers this repository
for real, which is the proof the stack composes against a real pnpm
workspace and is what originally surfaced the config-dependencies
lockfile-framing shape now owned by `@effected/lockfiles`.

Three `./testing` suites run against real things by design:

- `__test__/integration/SourceBoundarySelf.int.test.ts` scans this package's
  own `src/` with `SourceBoundary`, holding the `./testing` modules to the
  no-`process`, no-`node:`, no-console rule while finding the real reads
  elsewhere in the package.
- `__test__/integration/layering.int.test.ts` checks this repository's
  package graph against `lib/configs/layers.json`, with a positive control
  for every design-forbidden edge and an all-field acyclicity assertion.
- `__test__/e2e/PackedInstall.e2e.test.ts` drives the real npm, pnpm and bun
  (and yarn where present) against a fixture workspace it generates, with
  every spawn behind a dead proxy and corepack's network off. It is the only
  suite allowed to run a live package manager.

An unstubbed service-double member dies as a defect rather than being
absorbed by `Effect.catch` or any typed-error handler — code under test with
a best-effort catch around discovery or snapshot reads would otherwise make
a mandatory stub look optional, taking the catch branch and passing
green with an incomplete stub. The filesystem double delegates by default
instead, because the filesystem is not the thing under test, and a
deny-by-default volume would break the fixture every time the code under
test grew a new call.

## Build

`savvy.build.ts` carries a suppression scoped narrowly to the
`ae-forgotten-export` diagnostic on symbols matching `_base`, for the
synthesized bases api-extractor generates for class factories.[^savvy-build-ts]
That narrow scope has proven itself: a `@public` signature once named a
module-private interface, and the build correctly reported it as a genuine
forgotten export the narrow pattern did not mask, because that was real
surface a consumer needed to construct, so it was made public rather than
suppressed.

## See also

- [Workspaces discovery](../interfaces/workspaces-discovery.md)
- [The dependency graph](../interfaces/workspaces-graph.md)
- [Catalogs and the config-dependency seam](../interfaces/workspaces-catalogs.md)
- [Peer-dependency checking](../interfaces/workspaces-peer-check.md)
- [Duplicate-copy checking](../interfaces/workspaces-duplicate-check.md)
- [Git integration and snapshots](../interfaces/workspaces-snapshots.md)
- [The release surface](../interfaces/workspaces-release.md)
- [The sync-facade escape-hatch decision](../decisions/workspaces-sync-facade-escape-hatch.md)
- [The contract-inversion decision](../decisions/contract-inversion-default.md)
- [The second-published-entrypoint decision](../decisions/second-published-entrypoint.md)
- [The repo-shape checks](../interfaces/workspaces-repo-shape-checks.md)
- [D5: the repo-shape checks live in `@effected/workspaces/testing`](../decisions/repo-shape-checks-live-in-workspaces-testing.md)
- [The pack-source decision](../decisions/packed-install-pack-source.md)
- [The runtime-edge layering decision](../decisions/kit-layering-checks-runtime-edges.md)
- [Gotcha: ReleaseTag's strict-SemVer default](../gotchas/releasetag-strict-semver-default.md)
- [Gotcha: the publishability detector diagnoses late](../gotchas/publishability-detector-diagnoses-late.md)
- [Gotcha: PeerCheck never joins a link:-resolved parent's peers and still reports verified](../gotchas/peer-check-link-parent-reports-verified.md)
- [Limitation: PeerCheck cannot answer yarn](../limitations/workspaces-peer-check-yarn-and-suppression-axes.md)
- [Limitation: under the no-op hooks layer, a hook-injected catalog bump between refs is invisible to a snapshot diff](../limitations/workspaces-snapshot-hook-catalog-bump-between-refs.md)

[^package-json]: `packages/workspaces/package.json` — the `dependencies`,
    `peerDependencies`, and `exports` blocks.
[^internal-catalogs-ts]: `packages/workspaces/src/internal/catalogs.ts:1-12` —
    the header comment and the four `@pnpm/catalogs.*` imports.
[^index-ts]: `packages/workspaces/src/index.ts` — the package's only
    re-exporting module.
[^node-sync-ts]: `packages/workspaces/src/node-sync.ts:1-25` — the
    `@packageDocumentation` block stating why the subpath exists.
[^workspaces-sync-ts]: `packages/workspaces/src/WorkspacesSync.ts` —
    `SyncFileSystem`, `SyncDirectoryEntry`, and the sync facade functions.
[^savvy-build-ts]: `packages/workspaces/savvy.build.ts:7` — the
    `suppressWarnings` entry naming `ae-forgotten-export` and the `_base`
    pattern.
[^workspaces-ts]: `packages/workspaces/src/Workspaces.ts` —
    `WorkspacesGitOptions`, and `resolverLayer` and `resolveManifest`
    (`static readonly` members near the end of the file).
[^testing-ts]: `packages/workspaces/src/testing.ts` — the third entry point
    and its re-exports.
