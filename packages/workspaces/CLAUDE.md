# @effected/workspaces

Monorepo workspace tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm catalog resolution, lockfile IO, peer and duplicate checks, and git-based snapshots and change detection. **Integrated tier** — the `@pnpm/catalogs.*` quartet is why.

Durable knowledge about this package lives in the OKF bundle, not here. Start at `okf/modules/workspaces.md`, then load the concept a task needs:

- Module (tier and dependency posture, the two inverted contracts `CatalogResolver`/`WorkspaceResolver` and `LocalExec`, module layout, composites, the `WorkspacesSync` escape hatch, lazy init, hardening, testing, build) → `okf/modules/workspaces.md` — Load when: changing the error model, a composite layer, a dependency edge, or any service contract.
- Discovery (root finding and its `stopAt`/`maxDepth` bounds, the `packages:` enumerator, the shared traversal, `WorkspacePackage`, per-root `listPackagesIn`/`infoIn`, `PackageManagerDetector`, the doubles) → `okf/interfaces/workspaces-discovery.md` — Load when: touching enumeration, traversal, the root ascent, `WorkspacePackage` or the detector.
- Dependency graph (`DependencyGraph`, cycle payload, `levels`, Mermaid, where core's `Graph` is and is not used) → `okf/interfaces/workspaces-graph.md` — Load when: touching `DependencyGraph`, cycle detection, `levels` or the rendering.
- Catalogs and hook replay (PM-aware assembly, the release-age gate, `ConfigDependencyHooks`, the declared-version ladder, `layerSubprocess`, `peerDependencyRules` seeding) → `okf/interfaces/workspaces-catalogs.md` — Load when: touching catalog assembly, `ConfigDependencyHooks` or `peerDependencyRules`.
- Peer checking (`PeerCheck`, the three surfaced limits, the two `unverified` reasons, the three suppression axes, the committed oracle) → `okf/interfaces/workspaces-peer-check.md`, `okf/limitations/workspaces-peer-check-yarn-and-suppression-axes.md`, `okf/gotchas/peer-check-link-parent-reports-verified.md` — Load when: touching `PeerCheck`, the `unverified` reasons, the suppression axes or the peer fixtures. Every clause there is a defect someone already paid for; read it **before** touching any of it.
- Duplicate checking (`DuplicateCheck`, the two-version rule, the shared `internal/roots.ts` join) → `okf/interfaces/workspaces-duplicate-check.md` — Load when: touching `DuplicateCheck` or `internal/roots.ts`.
- Snapshots and change detection (`WorkspaceSnapshots.at(ref)`/`worktree()`, hook replay at a ref, `WorkspaceStateSnapshot`, seeded catalogs, importer versions, `ChangeDetector`) → `okf/interfaces/workspaces-snapshots.md`, `okf/limitations/workspaces-snapshot-hook-catalog-bump-between-refs.md` — Load when: touching at-ref reads, `WorkspaceStateSnapshot` or `ChangeDetector`.
- Release surface (`PublishabilityDetector`, `VersioningStrategy`, `ReleaseTag`, `TrackingTag`, `classifyTag`) → `okf/interfaces/workspaces-release.md`, `okf/gotchas/publishability-detector-diagnoses-late.md`, `okf/gotchas/releasetag-strict-semver-default.md` — Load when: working on publishability, versioning strategy or tag derivation.
- Why the sync facade and the `./node-sync` entry exist → `okf/decisions/workspaces-sync-facade-escape-hatch.md`, `okf/decisions/second-published-entrypoint.md` — Load when: adding or reshaping any `*Sync` function or a second entry point.
- The `LocalExec` direction and the contract-inversion rule → `okf/decisions/contract-inversion-default.md` — Load when: tempted to import this package from `commands`, `npm`, `lockfiles` or `package-json`.

## Operating rules

- `src/index.ts` is the only re-exporting module and **must never re-export** `./node-sync`; `src/internal/catalogs.ts` is the only module that may import `@pnpm/catalogs.*`; nothing new may build a local subprocess seam (git goes through `@effected/git`, anything else through core's `ChildProcessSpawner` via `@effected/commands`' `Run`); `minimatch` must not become a dependency.
- Never `Effect.cached` for a lazy init — the memo is `Effect.cachedInvalidateWithTTL` plus invalidate-on-non-success (Module, "Lazy init").
- `PeerCheck` and `DuplicateCheck` join importers to instances through ONE implementation, `src/internal/roots.ts`, so they cannot disagree about which importers are answerable; do not fork the join.
- Bind parameterized layer factories to a `const` (layers memoize by reference). `Workspaces.resolverLayer` is the deliberate exception.

## Testing and building

Tests run on core's `Path.layer` + `@effected/memfs` (a devDependency), no platform package; `__test__/fixtures.ts` seeds a volume from a `Tree` record and injects misbehaviour as faults.

- A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.
- `__test__/integration/self.int.test.ts` is the one exception: it discovers **this repository** through `@effect/platform-node` (a devDependency).
- Unit and integration tests never drive a live package manager. The `pnpm peers check` oracle under `__test__/fixtures/peers/*/peers-check.json` is committed pnpm output (provenance in that directory's `README.md`), and `PackedInstall`'s unit tests script every spawn through `ScriptedSpawner`.
- Only `__test__/e2e/` may run real package managers, and only against a fixture workspace it generates, with every spawn under the scrubbed dead-proxy offline env (`HTTP(S)_PROXY` at a closed port, `COREPACK_ENABLE_NETWORK=0`) so nothing reaches a registry. `e2e/PackedInstall.e2e.test.ts` is that exception.
- `savvy.build.ts` carries the **narrow** `_base` suppression for synthesized class-factory bases. Never widen it — the narrow pattern once caught a genuine `ae-forgotten-export`.
- Never run `node savvy.build.ts --target prod` directly — build through `pnpm build --filter @effected/workspaces`.
