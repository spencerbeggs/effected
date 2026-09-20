---
"@effected/workspaces": minor
---

## Features

`WorkspaceSnapshots.at(ref)` now replays that ref's `pnpm-workspace.yaml` `configDependencies` hooks at the version the ref itself declares, instead of always reading the live worktree's config. A hook-only catalog — one contributed entirely by a config-dependency's `pnpmfile.cjs`, such as `effect:peers` — now diffs correctly across a config-dependency bump between two refs; previously it could not change at all because `at(ref)` never re-ran hook replay for older refs.

Resolution walks a fail-closed ladder — `node_modules/.pnpm-config/<name>` when it holds the ref's declared version, else the pnpm store's `links/` tree — and a version installed nowhere now fails typed with a `CatalogAssemblyError` (`source: "hooks"`) naming the package, the declared version, and the remediation (`pnpm add --config <name>@<version>` in a throwaway workspace) instead of silently answering from whatever happens to be on disk. `WorkspaceSnapshots.layer` and `WorkspaceSnapshots.make`'s `R` gains `ConfigDependencyHooks` as a result.

New public surface supporting this:

```ts
import { ConfigDependencyHooks, Workspaces } from "@effected/workspaces";

// Hermetic seam: replay caller-supplied pnpmfiles with no resolution at all.
const hooks = ConfigDependencyHooks.layerFrom({
	"@scope/plugin@1.0.0": "/fixtures/plugin-1/pnpmfile.mjs",
	"@scope/plugin@2.0.0": "/fixtures/plugin-2/pnpmfile.mjs",
});

// Hand the SAME hooks reference to both WorkspaceCatalogs and WorkspaceSnapshots.
const KitLayer = Workspaces.layerWithGitAndHooks(hooks);
```

- `ConfigDependencyHooks.layerFrom(entries)` — the hermetic test seam above.
- `WorkspaceCatalogs.layerWithHooks(hooks, options)` and `Workspaces.layerWithGitAndHooks(hooks, options)` — build the catalogs/snapshots graph over a caller-chosen `ConfigDependencyHooks` layer instead of one of the fixed `layerNoop` / `layerLive` / `layerSubprocess` policies.
- `WorkspaceCatalogs.hookReplays()` — which version each declared config dependency was actually replayed from, off the same memoized assemble pass as `set()`.
- An optional `hookReplays` field (`name → declared version`) on `WorkspaceStateSnapshot`, set on every fresh read (`{}` under the no-op layer) and absent only when decoding a snapshot serialized before the field existed.
- `HookReplay` and `HookReplaySource` (`"installed" | "store" | "supplied"`) — the types recording which resolution rung answered, exported alongside the new `HookInjection.replays` field.

## Bug Fixes

`PeerCheck` now applies both `ignoreMissing` and `allowAny` from `peerDependencyRules` — pnpm `@pnpm/matcher` peer-name patterns, not `parent>peer` keys — replicating pnpm's post-hoc suppression for a required peer that resolved to nothing (`ignoreMissing`) and a peer that resolved outside its wanted range (`allowAny`). Previously only `allowedVersions` was applied, so a workspace relying on either axis saw `unverified: ["peerRulesNotApplied"]` findings that `pnpm peers check` considers clean.
