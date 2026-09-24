# @effected/workspaces

Monorepo tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm/bun catalog resolution, lockfile IO, unsatisfied peer-dependency detection, git change detection and point-in-time snapshots. Integrated tier: real runtime deps on the `@pnpm/catalogs.*` quartet (confined to one internal module) plus most of the kit's lower tiers.

## Import

```ts
import {
 ChangeDetector,
 DependencyGraph,
 PackageManagerDetector,
 PublishabilityDetector,
 WorkspaceDiscovery,
 WorkspaceRoot,
 Workspaces,
 WorkspaceSnapshots,
} from "@effected/workspaces";
```

**Not single-entrypoint**: the package ships two more exports. `@effected/workspaces/node-sync` holds the Node bindings for the sync escape hatch, so the main entry never imports `node:*`. `@effected/workspaces/testing` holds the repo-shape checks a monorepo runs in its own tests (`WorkspaceLayering`, `SourceBoundary`, `PackedInstall`), so a consumer of `.` never loads them. Neither is re-exported from `.`.

```ts
// The repo-shape checks — a separate subpath, never re-exported from the main entry.
import { LayerPolicy, PackedInstall, SourceBoundary, WorkspaceLayering } from "@effected/workspaces/testing";

const offences = SourceBoundary.check("src/a.ts", "const argv = process.argv;", ["process"]);
console.log(offences.length, typeof LayerPolicy.load, typeof WorkspaceLayering.check, typeof PackedInstall.run);
// => 1 function function function
```

```ts
// Node bindings for the sync escape hatch — a separate subpath, not the main entry.
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";

const root = findWorkspaceRootSync(process.cwd(), nodeSyncOps);
const packages = root === null ? [] : getWorkspacePackagesSync(root, nodeSyncOps);
```

The platform-agnostic sync functions (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, and the `WorkspacesSyncOptions`/`SyncFileSystem`/`SyncPath` types they take) live in the MAIN entrypoint — they accept consumer-supplied file/path operations and import no platform module themselves. Only the ready-made Node bindings (`nodeFileSystem`, `nodePath`, and the combined `nodeSyncOps`) live under `./node-sync`. Reach for either where you genuinely cannot run an Effect (a Vitest config is the motivating case); the async `WorkspaceRoot`/`WorkspaceDiscovery` services are the default.

**A version-less manifest is a member on BOTH surfaces.** A root or member `package.json` with no `version` (`{"name":"x","private":true}`) is the ordinary pnpm shape, and discovery treats it as pnpm does: the package is discovered with `WorkspacePackage.version` absent (the field is `optionalKey` — never `"0.0.0"`, never a present `undefined`). `listPackages()` no longer fails on it and there is no `missingVersion` kind; a `version` that is present but not a string — or present but empty (`""`) — fails as `invalidShape`. What still fails typed on the Effect surface is a genuinely unusable manifest — unreadable, not JSON, not an object, or nameless — because a member that goes undiscovered with no diagnostic is the failure this package exists to prevent. If you want skip-don't-fail enumeration over THOSE, the sync facade skips them and reports each one through `onSkip`; it is a second, independent reason to choose it beyond "I cannot run an Effect".

**Platform**: you provide `FileSystem` and `Path` at the edge — `@effect/platform-node` or `@effect/platform-bun`. `Workspaces.layerWithGit` and `Workspaces.layerWithConfigDependenciesSubprocess` additionally need `ChildProcessSpawner`; `NodeServices.layer` provides all three in one move.

## Core API

- **`Workspaces.layer(options?)`** / `.layerWithConfigDependencies` / `.layerWithConfigDependenciesSubprocess` / `.layerWithGit` / `.layerWithGitAndConfigDependencies` / `.layerWithGitAndConfigDependenciesSubprocess` / `.layerWithGitAndHooks(hooks)` — composite layers wiring everything (the full set is `WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery | LockfileReader | WorkspaceCatalogs | PublishabilityDetector`, plus `ChangeDetector | WorkspaceSnapshots | Git` from `.layerWithGit`). **`Workspaces.resolvers`** merges the real implementations of `@effected/npm`'s `CatalogResolver` + `WorkspaceResolver` contracts — provide it wherever `Package.resolve` (from `@effected/package-json`) must turn `catalog:`/`workspace:` specifiers into real versions. **`Workspaces.resolverLayer(options?)`** is the same pair but built fresh (unmemoized) per call — the deliberate exception, so a long-lived tool that changes directory between manifests re-runs root discovery each time. **`Workspaces.resolveManifest(manifest, options?)`** is the one-call path: runs `@effected/npm`'s `Manifest.resolve()` over a fresh `resolverLayer`; check the manifest's own `needsResolution` first to skip catalog assembly entirely when nothing needs it.
- **`WorkspaceRoot`** — root discovery over `@effected/walker`; markers: `pnpm-workspace.yaml`, then `package.json` with `workspaces`. `WorkspaceRootNotFoundError`.
- **`WorkspaceDiscovery`** — `listPackages()` enumerates `WorkspacePackage`s (tolerant schema; `pkg.manifest()` bridges to the strict `@effected/package-json` `Package` on demand); also implements the `WorkspaceResolver` contract.
- **`WorkspacePackage`** — fields: `name`, `version?` (raw string, NOT semver-validated; ABSENT when the manifest declares none — read it as `pkg.version ?? …` or `Option.fromUndefinedOr`), `path`, `packageJsonPath`, `relativePath`, `private`, the four dependency maps, `publishConfig?: PublishConfig`, `manifestRecord` (the as-read `package.json`, `unknown` values, for tolerant access to fields outside the typed slice). Getters: `isRootWorkspace`, `isPublic`, `scope: Option<string>`, `unscopedName`, `allDependencies` (merged, `dependencies` > `devDependencies` > `peerDependencies` > `optionalDependencies` on a name in several). Methods: `hasDependency`/`hasDevDependency`/`hasPeerDependency`/`hasOptionalDependency`/`hasAnyDependencyOn(name)`, `dependencyVersion(name): Option<string>`, `matchesDependency(pattern: GlobPattern | string)` (a raw string is compiled per call — a bad literal is a caller-wiring defect, not a typed error; compile once with `GlobPattern.compile` when testing many packages), `dependencyDiff(other)` → `DependencyDiff` (`added`/`removed`/`changed`, merged across all four kinds), `toWorkspaceManifest()` (projects to `@effected/lockfiles`' `WorkspaceManifest`), `manifest()` (re-reads and decodes the strict `Package`, `Effect<Package, WorkspaceManifestError, FileSystem>`).
- **`PublishConfig`** — the typed projection of `publishConfig` workspace tooling reads: `access?`, `registry?`, `directory?`, `linkDirectory?` (whether workspace links point into `directory` during local development — pnpm symlinks the publish directory instead of the package root; meaningful only alongside `directory`), `tag?`. Deliberately narrow — `@effected/package-json` keeps the full open record for round-trip fidelity; this is the handful of fields that decide where/whether/as-what a package publishes.
- **`PublishabilityDetector`** — `Context.Service`; `detect(pkg: WorkspacePackage) => Effect<ReadonlyArray<PublishTarget>>` — an intentionally TOTAL (`never`-erroring) question: empty means "does not publish". `PublishabilityDetector.layer` implements standard npm semantics (private + no `publishConfig.access` → publishes nowhere; explicit `access` overrides `private`; otherwise public with defaults). An overriding layer with a fallible lookup must degrade to a safe answer or `Effect.die` — it cannot widen the `never` channel. `PublishTarget` — `name`, `registry`, `directory`, `access: "public" | "restricted"`, `provenance` (defaulted).
- **`DependencyGraph`** — pure value class: `sort`, `sortSubset`, `levels` (deterministic Kahn), `hasCycle`, `dependenciesOf`/`dependentsOf`, `toMermaid()` (total, deterministic `flowchart TD` via core `Graph.toMermaid`); `CyclicDependencyError.cycle` names the actual cycle members (SCC union via core `Graph.stronglyConnectedComponents`), never packages merely downstream of the cycle.
- **`PackageManagerDetector`** — `"npm" | "pnpm" | "yarn" | "bun"` from lockfile evidence + `packageManager`/`devEngines` fields.
- **`WorkspaceCatalogs` / `CatalogSet`** — pnpm/bun catalog assembly; `WorkspaceCatalogs.catalogResolver` implements the `CatalogResolver` contract. `releaseAgeGate()` folds the inline `minimumReleaseAge` keys and the hook contributions into one gate. **`peerDependencyRules()`** → `Effect<PeerDependencyRules, CatalogAssemblyFailure>` — the workspace's **effective** `peerDependencyRules`, i.e. pnpm's post-hoc peer-violation suppression policy, obtained by replaying config-dependency pnpmfile hooks the same way catalogs and release-age are; feed the result straight to `PeerCheck.run`'s `peerDependencyRules` option. `PeerDependencyRules` is pnpm's own shape verbatim: `{ allowedVersions: Record<string, string>, ignoreMissing: readonly string[], allowAny: readonly string[] }`. `NoPeerDependencyRules` is the exported "I looked, there are none" value — see the trap below.
- **`ConfigDependencyHooks`** — the opt-in pnpmfile-replay seam, with **four** layers: `layerNoop` (the default — executes nothing), `layerLive` (in-process `import()`), `layerSubprocess` (a `node` child, the one that survives bundling) and `layerFrom({ "<name>@<version>": pnpmfilePath })` (the hermetic test seam, no resolution, no `FileSystem`). Matching composites live on `WorkspaceCatalogs` (`layerWithHooks(hooks)`) and `Workspaces` (`layerWithGitAndHooks(hooks)`). **Every replaying layer loads the pnpmfile of the version each `configDependencies` entry DECLARES.** `layerLive` and `layerSubprocess` resolve it — `node_modules/.pnpm-config/<name>` when its manifest matches, else the pnpm store's `links/<name>/<version>/*/node_modules/<name>` (the store keeps every version ever installed; `.pnpm-config` entries are symlinks into it), else a typed fail-closed `CatalogAssemblyError` (`source: "hooks"`) whose `cause.message` names the remediation (`pnpm add --config <name>@<version>` in a throwaway workspace — `pnpm store add` does NOT populate `links/`). Two honest store copies of one version in one store are ambiguous and fail closed too. `layerFrom` resolves nothing: it looks the declared `"<name>@<version>"` up in the caller's map and fails closed on a miss. `inject` returns one `HookInjection { catalogs, releaseAge, peerDependencyRules, replays }` — one replay, four outputs; `replays` records `{ version, source: "installed" | "store" | "supplied" }` per dependency.

| Layer | What it does | Composite | Requires |
| --- | --- | --- | --- |
| `layerNoop` | executes NO config-dependency code (the seed through: `{ catalogs: seed, releaseAge: {}, peerDependencyRules: the rules it was handed }`) | `layer` — the **default** | — |
| `layerLive` | dynamic `import()` of each pnpmfile **in process**, then replays `updateConfig`, threading all three outputs | `layerWithConfigDependencies` | — |
| `layerSubprocess` | the same replay, and the same three outputs, in a `node` child process | `layerWithConfigDependenciesSubprocess` | core's `ChildProcessSpawner` |

Every layer answers the **same three-output contract** — `inject` returns one `HookInjection { catalogs, releaseAge, peerDependencyRules }`. A layer that contributed only two would be a different seam, not a lighter one.

**Reach for `layerSubprocess` in any BUNDLED consumer** — a GitHub Action, above all. `layerLive` computes its `import()` target at runtime, and a bundler (rspack) compiles a computed dynamic import into a context module that throws `Cannot find module 'file:///…'`, so `releaseAgeGate()` — the reason to opt into hooks at all — was simply uncallable from a bundled action. `layerSubprocess` moves the computed load out of the bundle graph via a **static** argv script; the two layers are drop-in interchangeable and typed-semantics parity is pinned by an integration test driving both against one fixture. The child prints one JSON envelope line, which the parent decodes with `@effected/commands`' `Run.jsonLine` (never a hand-rolled last-line parse); folding and normalization stay in the parent, and the `..`-segment guard runs **before** any spawn.

- **`ChangeDetector`** — `changedFiles`/`workingChanges` over `@effected/git` (`includeUncommitted` option).
- **`WorkspaceSnapshots`** — `at(ref)` (git-only, no checkout, cached per `(root, ref)`) and `worktree()` (live tree, uncached), both returning `WorkspaceStateSnapshot` (`versions`, `package(name)`, `resolve(...)`, `hookReplays` (name → declared config-dependency version), snapshot-scoped resolver layers). `at(ref)` requires `ConfigDependencyHooks` in `R` and replays the REF's own `configDependencies` at the versions that ref declares, through the same hooks reference the worktree side uses — so under a replaying composite a hook-only catalog (`effect:peers`) diffs correctly across a config-dependency bump, and under the default composite nothing executes on either side.
- **`LockfileReader`** — root → PM detection → file read → `Lockfile.parse`.
- **`PeerCheck`** — unsatisfied peer-dependency detection as a **pure value class**, not a service: no IO, nothing in `R`, no error channel. `PeerCheck.run(lockfile, options?)` reads a parsed `@effected/lockfiles` `Lockfile` — `instanceId`/`resolved`/`peerDependencies` — and past a single `lockfile.format` support gate the traversal is format-free, which is the point: shelling out to each manager's own peer command cannot deliver bun (no such command exists, and its one warning line appears only on the install that changes the tree), so the answer has to come from the resolved graph. Returns `{ supported, unsatisfied, unresolvedImporters, unverified }` plus a `required` getter (the non-optional rows). `UnsatisfiedPeer` — `{ importer, dependency, wanted, found: string | null, optional, parents: PeerParent[] }`; `parents` is *a* route to the declaring package, and a package an importer reaches by several routes yields ONE row, as pnpm reports it. Reach for this over hand-rolling a peer check, or over shelling out to `npm`/`pnpm`/`bun`, for anything asking "is this workspace's peer graph satisfied".
- **Sync escape hatch (bare consts, NOT a `WorkspacesSync` namespace)** — `findWorkspaceRootSync(cwd, options)` / `getWorkspacePackagesSync(root, options)`, both re-exported from the MAIN entrypoint and platform-agnostic. There is no `WorkspacesSync` namespace object; each is a free-standing const taking the path positionally first, then a required options bag that carries a consumer-supplied `SyncFileSystem`/`SyncPath` — nothing defaults to Node, and nothing reads `process.cwd()` ambiently. Pass `nodeSyncOps` from `@effected/workspaces/node-sync` as shown above. For config-time discovery that cannot `await` (e.g. a vitest config). Both are **total** — an unenumerable pattern or unreadable manifest is skipped, never raised, and only truncate at a depth/budget bound where the async surface fails typed. That totality makes them the tolerant-enumeration path as well as the sync one (see above). **A skip is never silent**: pass `onSkip` in the options bag and `getWorkspacePackagesSync` reports every manifest it leaves out as a `WorkspaceDiscoverySkip` — `{ root, path, kind, cause }`, where `kind` is `WorkspaceDiscoverySkipKind` (`"read" | "invalidJson" | "invalidShape" | "missingName"`, the `WorkspaceDiscoveryError` vocabulary minus `invalidYaml`). A manifest with no `version` is NOT a skip — it is a member with `version` absent. When an enumeration comes back suspiciously empty, wire `onSkip` before concluding the workspace is empty; it was the silent version-less drop that once made `{ "name": "demo" }` look like "no workspaces configured" (#605).

- **`@effected/workspaces/testing`** — the repo-shape checks, each a static class:
  - **`SourceBoundary`** — `check(file, text, rules, options?)` (pure, returns `Offence[]`), `referencesProcess`, `importSpecifiers`, `importsNode`, `stripComments`, `scan(options)` over `FileSystem`/`Path` returning a `SourceScan { files, allowed, offences }` with a `violations` getter, and the shipped positive controls `fixtures` / `verifyFixtures()`. Rules (`BoundaryRule`): `"process"`, `"node:process"`, `"stdout-write"`, `"console-write"`, `{ forbidImports }` (a trailing `*` is a prefix).
  - **`WorkspaceLayering`** — `check(graph: LayeringGraph, policy)` (pure, returns `LayeringReport`), `edgesOf(packages)` (one `LayerEdge` per declaring field), `checkWorkspace(policy)` over `WorkspaceDiscovery`. `LayeringReport` has `duplicates`, `unclassified`, `offenders` (`{ edge, reason }`, reason `upward` / `sameLayer` / `toolingReachesLayer` / `intoUnconstrained` / `intoUnclassified`), `cycle`, `missingDeclared`, `missingRequiredEdges`, `edgeCount` and a `violations` getter that also flags `edgeCount === 0`.
  - **`LayerPolicy`** — the `layers.json` schema (`layers`, `tooling`, `unconstrained` globs, optional `fields` and `requiredEdges`), with `decode(input, { path?, allowKeys? })` and `load(path, { allowKeys? })` failing `LayerPolicyError` (`read` / `json` / `decode`). Decoding is strict: an unknown key fails `decode` naming it (a typo'd `requiredEdge` would otherwise drop the non-vacuity guard); `$schema` is always accepted, and a file's own keys go in `allowKeys`.
  - **`PackedInstall`** — `run(options)` packs the carrier and its closure (`"auto"` = transitive runtime workspace deps), installs it into a scratch consumer per available manager, and returns `PackedInstallResult { consumers: InstalledConsumer[], unavailable, tarballs }`; `InstalledConsumer.binPath(name)`; `scrubEnv(env)`. Requires `FileSystem | Path | Scope | ChildProcessSpawner | WorkspaceDiscovery`; fails `PackedInstallError` with a `reason`. `packFrom` defaults to `{ directory: "dist/prod/npm/pkg" }`.

## Usage

Diffing dependency state between two points in time — a released tag and the live working tree:

```ts
import { WorkspaceSnapshots } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const snapshots = yield* WorkspaceSnapshots;
 const before = yield* snapshots.at("v1.2.0");
 const after = yield* snapshots.worktree();
 return { before: before.versions, after: after.versions };
});
```

`PublishabilityDetector` with a test double — override the shape's `never` error channel per the "degrade or die" contract, and filter a package list down to what actually publishes:

```ts
import type { WorkspacePackage } from "@effected/workspaces";
import { PublishabilityDetector, PublishTarget } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const scopedOnly = Layer.succeed(PublishabilityDetector, {
 detect: (pkg) =>
  Effect.succeed(
   pkg.name.startsWith("@acme/")
    ? [PublishTarget.make({ name: pkg.name, registry: "https://registry.acme.dev/", directory: ".", access: "restricted" })]
    : [],
  ),
});

const publishableNames = (packages: ReadonlyArray<WorkspacePackage>) =>
 Effect.gen(function* () {
  const detector = yield* PublishabilityDetector;
  const names = new Set<string>();
  for (const pkg of packages) {
   const targets = yield* detector.detect(pkg);
   if (targets.length > 0) names.add(pkg.name);
  }
  return names;
 }).pipe(Effect.provide(scopedOnly));
```

Composing `Workspaces.layerWithGit` for a downstream service that needs several kit services at once — build the graph ONCE and reuse it, since layers memoize by reference:

```ts
import type { WorkspaceSnapshotWorktreeFailure } from "@effected/workspaces";
import { WorkspaceDiscovery, Workspaces, WorkspaceSnapshots } from "@effected/workspaces";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";

class Reporter extends Context.Service<
 Reporter,
 { readonly run: () => Effect.Effect<unknown, WorkspaceSnapshotWorktreeFailure> }
>()("Reporter") {}

// Bind once — calling layerWithGit again mints an independent graph.
const KitGraph = Workspaces.layerWithGit();

const ReporterLive = Layer.effect(
 Reporter,
 Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const snapshots = yield* WorkspaceSnapshots;
  return {
   run: () =>
    Effect.gen(function* () {
     const packages = yield* discovery.listPackages();
     const state = yield* snapshots.worktree();
     return { count: packages.length, versions: state.versions };
    }),
  };
 }),
).pipe(Layer.provide(KitGraph), Layer.provide(NodeServices.layer));
```

`PeerCheck` gating a build — the predicate that actually means "clean", and threading `peerDependencyRules()` so the report is verified rather than fail-closed:

```ts
import { LockfileReader, PeerCheck, WorkspaceCatalogs } from "@effected/workspaces";
import { Effect } from "effect";

const isClean = (report: PeerCheck): boolean =>
 report.supported && report.unresolvedImporters.length === 0 && report.unverified.length === 0 && report.required.length === 0;

const program = Effect.gen(function* () {
 const reader = yield* LockfileReader;
 const catalogs = yield* WorkspaceCatalogs;
 const lockfile = yield* reader.read();
 const peerDependencyRules = yield* catalogs.peerDependencyRules();
 const report = PeerCheck.run(lockfile, { peerDependencyRules });
 return isClean(report);
});
```

### Repo-shape checks in a consumer's own tests

```ts
// __test__/repo-shape.test.ts, one level below the workspace root
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Workspaces } from "@effected/workspaces";
import { LayerPolicy, SourceBoundary, WorkspaceLayering } from "@effected/workspaces/testing";
import { Effect, Layer } from "effect";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

describe("repo shape", () => {
 layer(Live)((it) => {
  it.effect("the package graph honours layers.json, over real edges", () =>
   Effect.gen(function* () {
    const report = yield* WorkspaceLayering.checkWorkspace(yield* LayerPolicy.load(join(ROOT, "layers.json")));
    assert.deepStrictEqual(report.violations, []);
    assert.isAbove(report.edgeCount, 0);
   }),
  );

  it.effect("the engine's source reads no process and imports no node: module", () =>
   Effect.gen(function* () {
    assert.deepStrictEqual(SourceBoundary.verifyFixtures(), []);
    const scan = yield* SourceBoundary.scan({
     root: join(ROOT, "packages", "engine", "src"),
     rules: ["process", { forbidImports: ["node:*", "@effect/platform*"] }],
    });
    assert.isNotEmpty(scan.files);
    assert.deepStrictEqual(scan.violations, []);
   }),
  );
 });
});
```

For `PackedInstall` plus `McpProbe` on an MCP bin, see the package README's "Packed install" example: run each bin through `consumer.binPath(name)` under `PackedInstall.scrubEnv(process.env)`, inside the same scope as `run`.

## Testing machinery

No service doubles are exported under `./testing` — that subpath holds the repo-shape checks above, not test doubles. Unit-test consumers with core's `Path.layer` + `FileSystem.layerNoop`; stub git-backed services with `@effected/git`'s own shipped `Git.layerTest({ … })` (unstubbed members die named — never hand-enumerate `GitShape`, which breaks on every growth of that service) and publishability with `Layer.succeed(PublishabilityDetector, ...)` — no real repo or platform package needed.

## Gotchas

- `PackageManagerName` is structurally identical to `@effected/lockfiles`' `LockfileFormat` but is a different concept — don't conflate them when importing both.
- `WorkspacePackage` is deliberately tolerant (one bad member must not fail whole-repo discovery); `version` is optional and a version-less member is discovered, not rejected; `pkg.manifest()` — a method call, not a property — opts into the strict decode, and genuinely re-reads the file rather than reusing `manifestRecord`. `WorkspaceResolver.versionOf` fails typed (`DependencyResolutionError`) for a member with no version — `none` is reserved for a non-member.
- Layer factories taking options (`WorkspaceDiscovery.layer({ cwd })`, `WorkspaceSnapshots.layer(...)`) mint a fresh layer per call — bind to a `const`; layers memoize by reference. `Workspaces.resolverLayer` is the deliberate exception: a fresh layer per call IS the feature.
- `WorkspaceSnapshots.at(ref)` and `worktree()` replay through ONE hooks reference per composite, so they cannot diverge on policy; never provide a different `ConfigDependencyHooks` to each side by hand-composing. Keep `WorkspaceStateSnapshot.crossSeed` in a diff path — under a replaying layer the seed is inert where the ref answers, and under `layerNoop` it is what recovers the declared range.
- `PublishabilityDetector`'s error channel is `never` by contract — an overriding layer backed by something fallible must fold failures into a safe answer or `Effect.die`; it cannot widen the channel the shape declares.
- `matchesDependency` compiles a raw string pattern on every call; an uncompilable literal throws as a defect (developer wiring, not untrusted input) rather than a typed error.
- **`PeerCheck.run` fails closed, and an empty `unsatisfied` is NOT the same as clean.** The real "nothing wrong" predicate is `supported && !report.unresolvedImporters.length && !report.unverified.length && !report.required.length` — check all four, not just `unsatisfied`. `unverified` is `"peerRulesNotApplied" | "unresolvedEdge"`; both mean fail closed, and no distinction between them is meaningful to a consumer.
- **Presence of the `peerDependencyRules` option key is the assertion, not its contents.** Omitting the key entirely means "nobody looked" and always yields `"peerRulesNotApplied"`; passing `NoPeerDependencyRules` means "I looked, there are none" and yields a verified report. The two are deliberately different results — never normalize an omitted option to `NoPeerDependencyRules` before calling `run`, and never treat the two as equivalent.
- `PeerCheck` is unsupported for yarn (`supported: false`) — yarn resolves peers virtually and the lockfile does not record which virtual instance satisfied which peer, so the answer is not recoverable rather than merely unimplemented.
- `PeerCheck.run` applies all three `peerDependencyRules` axes. `allowedVersions` keys are `parent>peer` (parent version ignored) or a bare peer name; `ignoreMissing` and `allowAny` are **`@pnpm/matcher` peer-name patterns** (`*` wildcard, lone `*` matches all, leading `!` negates, an all-negation list matches everything not excluded), NOT `parent>peer` keys — those match nothing on the two list axes. `ignoreMissing` hides only a required peer that resolved to nothing; `allowAny` hides only a peer that resolved outside its range; they never cross. `"peerRulesNotApplied"` fires only when the `peerDependencyRules` option KEY is omitted.
- **A devDependency-only cycle is invisible** to a `LayerPolicy` whose `fields` are runtime-only: `edgesOf` draws one edge per declaring field and `check` reads only the policy's fields. Pin all-field acyclicity separately with `DependencyGraph.make({ packages }).hasCycle`.
- **`SourceBoundary` has no scope analysis.** ANY local binding named `process` or `console` — a parameter (`(process: Handle) => process.kill()`), a variable, a label, an unannotated class field `process = 1` — is flagged like the global; an annotated `process: T` reads as a type member and is spared. Prefer renaming the binding; otherwise exempt that one file with an `allow` glob (it skips every rule) and assert `scan.allowed` names exactly it — do not drop the rule. `globalThis["process"]`, `const { process: p } = globalThis`, a regex right after a block-closing `}`, and JSX text are known misses.
- **`forbidImports: ["node:*"]` misses a bare built-in** (`"fs"`). To mean "no Node built-ins", spread `builtinModules` from `node:module` in the test file: `["node:*", ...builtinModules]` (it also forbids npm packages named like a built-in, e.g. `events`).
- **The root package must be classified.** Discovery always returns it (`relativePath` `"."`); a policy that forgets it reports it in `unclassified`. Usually an `unconstrained` glob.
- **`PackedInstall` is POSIX-only** (`UnsupportedPlatform` otherwise), and its scratch directory lives only as long as the scope: run the installed bins inside the same scope, never after it closes.
- **Pass `process.env` in** — nothing under `./testing` reads `process` — and run the installed bins under `PackedInstall.scrubEnv(process.env)`, the environment the installs ran under. Declare every package the consumer's own code imports in `consumerDependencies`: pnpm links only declared dependencies at a project's top level. An entry naming a packed package is written as its `file:` tarball whatever spec you pass (npm fails `EOVERRIDE` on a direct spec that differs from its override), so any range will do.
