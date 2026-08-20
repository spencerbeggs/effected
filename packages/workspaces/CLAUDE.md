# @effected/workspaces

Monorepo workspace tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm catalog resolution, lockfile IO and git-based change detection.

**Design doc:** `@../../.claude/design/effected/packages/workspaces.md` — Load when: changing the enumerator, the error model, or any service contract. Release surface: `@../../.claude/design/effected/packages/workspaces-release.md` — Load when: working on `PublishabilityDetector`, `VersioningStrategy` or `ReleaseTag`.

## Child context files

Reasoning behind the rules below. Load on demand:

- Public surface → `@./CLAUDE.surface.md` — Load when: locating a type, wiring a composite, or touching an entry point.
- Discovery → `@./CLAUDE.discovery.md` — Load when: touching enumeration, traversal, the root ascent, `WorkspacePackage` or the detector.
- Catalogs → `@./CLAUDE.catalogs.md` — Load when: touching catalog assembly, the release-age gate, `ConfigDependencyHooks` or `peerDependencyRules` seeding.
- Peers → `@./CLAUDE.peers.md` — Load when: touching `PeerCheck`, the `unverified` reasons, the suppression axes or the peer fixtures.
- Snapshots → `@./CLAUDE.snapshots.md` — Load when: touching at-ref reads, `WorkspaceStateSnapshot` or `ChangeDetector`.

## Tier: integrated

The `@pnpm/catalogs.*` quartet is why: those packages *are* pnpm's catalog semantics, versioned to pnpm majors. They are confined to `src/internal/catalogs.ts` — **the only module that may import them** — so the tier-3 blast radius is one file.

Kit edges are `workspace:^`: `commands`, `git`, `glob`, `lockfiles`, `walker`, `yaml`, `package-json`, `npm`, and `semver` (a peer `@effected/lockfiles` requires). `effect` is a peer.

**The `@effected/commands` edge points at a CONTRACT plus `Run` combinators, and its direction is load-bearing.** `commands` declares `LocalExec` and we implement it (`Workspaces.localExecLayer`) — the `@effected/npm` `CatalogResolver` precedent. **Never invert it**: an import of this package from `commands` makes `commands` integrated and drags `npm`, `lockfiles` (**pure**) and `package-json` up a tier.

**`minimatch` is not a dependency and must not become one.** Both call sites — `WorkspacePackage.matchesDependency` and the `packages:` enumerator — run on `@effected/glob`'s vendored engine.

**Nothing new may build a local subprocess seam.** Git work goes through `@effected/git`; any other child process goes through core's `ChildProcessSpawner` required in `R` (via `@effected/commands`' `Run`). No `node:child_process` import exists in `src/`.

`src/index.ts` is the only re-exporting module, and it **must never re-export** the second entry, `@effected/workspaces/node-sync`, or `node:` imports leak into every consumer.

## Publishability has no ambient default

**No composite provides `PublishabilityDetector` — and none requires it either**, so `Workspaces.layer`, `layerWithGit` and `layerWithConfigDependencies` all keep an `R` of `FileSystem | Path`. The requirement surfaces in the `R` of each **operation** asking a publishability question (`VersioningStrategy.detect`), so unwired programs fail to compile far from the wiring site. Provide it as one explicit merge, NOT `Layer.provide` onto the composite (`provide` discards what the composite never required, so it never reaches the program's `R`):

```ts
const WorkspacesLayer = Layer.mergeAll(Workspaces.layer(), PublishabilityDetector.layerNpm);
```

That is a correctness fix, not ergonomics: when the composite supplied npm semantics itself, `Layer.mergeAll`'s **last-wins** rule made the natural spelling of an override silently resolve to the public-npm *default*, with no type error. **Never re-bake a detector into `compose`**; the "the order that used to silently lose" test in `__test__/Workspaces.test.ts` fails if you do.

## The other things that will bite you

- **Never `Effect.cached`.** Every lazy init uses `Effect.cachedInvalidateWithTTL` + `Effect.onExit`-invalidate-on-non-success. `Effect.cached` memoizes the first `Exit` *including an interrupt*, so an init interrupted by an unrelated timeout permanently poisons the layer with a cause outside its error channel. Success is memoized; failures and interrupts retry.
- **Core's `Graph` is borrowed at two `DependencyGraph` call sites, never as the substrate.** `CyclicDependencyError.cycle` (the SCC union, never Kahn's stalled set — that blames downstream packages) and `toMermaid` build transient graphs; `levels` cannot follow, as core's `topo` exposes no wave boundaries.
- **One traversal, two entry points.** `internal/traverse.ts` owns the dequeue order, the depth rule, the visit budget and the prune list; neither the Effect enumerator nor `WorkspacesSync` may re-decide any.
- **Lockfile framing is not this package's job.** `@effected/lockfiles` owns pnpm's multi-document `pnpm-lock.yaml`; `LockfileReader` just calls `Lockfile.parse`. Do not reintroduce the deleted richest-document-wins workaround (`internal/documents.ts`, `parseLockfileText`).
- **`PackageManagerDetector` refuses to guess — do not give it a default.** Nothing matching its three tiers is `PackageManagerDetectionError`, and an unstubbed `detect` on the double **dies** rather than fabricating or failing typed. A consumer wanting a default writes `Effect.orElseSucceed` at its own call site.
- **`localExecLayer`: `None` is success, and only a BROKEN manifest is an error.** No workspace root and `PackageManagerDetectionError` → `Option.none()`; `WorkspaceManifestError` → `LocalExecError`. Mutation-pinned both directions in `__test__/LocalExec.test.ts`. `directory` is the resolved **workspace root**, not the caller's cwd, and all three argv prefixes come from `LocalExec.prefixes(name)` — **never hard-code an exec, dlx or script-runner prefix here.**
- **Tracking tags never float onto a prerelease.** `TrackingTag.forVersion("1.0.0-beta.3")` returns `[]`. Two related traps: `+build` is NOT a prerelease (strip build metadata *before* the `-` test), and derivation is **total** (junk yields `[]`, never a throw). `classifyTag` tells the families apart by **segment count, not the `v`**. The grammar deliberately avoids `@effected/semver`; route there only for real semver *comparison*.
- **`PeerCheck` answers from the resolved graph, never from a subprocess.** It is a pure value over a parsed `@effected/lockfiles` `Lockfile` (`instanceId` / `resolved` / `peerDependencies`), so **no per-format branch exists** and none may be added. `PeerCheck.run(lockfile, options?)` **fails closed** through a two-reason `unverified` (`"peerRulesNotApplied"`, `"unresolvedEdge"`), surfaces its three unanswerable limits in the value rather than swallowing them, and applies only `allowedVersions` — `ignoreMissing` and `allowAny` are carried unwired and force `"peerRulesNotApplied"` when non-empty. Read [peers](./CLAUDE.peers.md) **before touching any of it**; every clause there is a defect someone already paid for.
- **The `pnpm peers check` oracle is committed, never shelled out to.** `__test__/fixtures/peers/*/peers-check.json` is pnpm's verbatim output captured at fixture-generation time (provenance in that directory's `README.md`); a test needing a live pnpm on PATH would breach the no-new-subprocess-seam rule and would not be reproducible in CI.
- **Catalog assembly hard-fails on the live path** — a malformed inline block, or a default catalog declared twice, fails typed, because a silently-empty catalog is the "every dependency looks newly added" bug. The at-ref readers are deliberately tolerant of the same shapes.
- **The default composite runs no config-dependency code.** `Workspaces.layer` / `WorkspaceCatalogs.layer` wire `layerNoop`; replay is opt-in (`layerWithConfigDependencies`, or `…Subprocess`). Never replay a hook to repair an at-ref `catalog:` lookup — the fallback reads that ref's own lockfile importer entry.
- **Layers memoize by reference**, so bind a parameterized factory to a `const`. `Workspaces.resolverLayer` is the exception: fresh and unmemoized per call is the feature.

## Testing and building

454 tests, on core's `Path.layer` + `@effected/memfs` (a devDependency) — a real virtual filesystem, no platform package (`__test__/fixtures.ts` seeds one from a `Tree` record and injects its three misbehaviors as faults).

- A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.
- `__test__/integration/self.int.test.ts` is the one exception: it discovers **this repository** through `@effect/platform-node` (a devDependency), the only proof the stack composes against a real pnpm workspace.
- `savvy.build.ts` carries the **narrow** `_base` suppression for the synthesized error/schema-class bases. **Never widen it** — it caught a genuine `ae-forgotten-export` when `VersioningStrategy.tagsFor` named a module-private interface on a `@public` signature (fixed by exporting `PackageRelease`).
- Never run `node savvy.build.ts --target prod` directly — build through `pnpm build --filter @effected/workspaces`.
