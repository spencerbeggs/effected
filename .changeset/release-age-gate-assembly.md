---
"@effected/workspaces": minor
---

## Breaking Changes

### `ConfigDependencyHooks.inject` returns `HookInjection`, not a bare catalogs record

`inject` previously resolved to the catalogs a replayed `updateConfig` hook
produced. It now resolves to a `HookInjection`:

```ts
interface HookInjection {
	readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly releaseAge: PartialReleaseAgeGate;
}
```

One hook replay now yields both the catalogs and the release-age keys
(`minimumReleaseAge` / `minimumReleaseAgeExclude`) the hooks leave on the
config, so the config-dependency code — which executes arbitrary
`pnpmfile.cjs` logic — still runs exactly once. When two hooks both set a
release-age key, the later hook wins. `ConfigDependencyHooks.layerNoop` now
returns `{ catalogs: seed, releaseAge: {} }` instead of the bare seed. A
caller that awaited `inject` directly and read the catalogs off the resolved
value needs to read `.catalogs` instead.

## Features

### `WorkspaceCatalogs.releaseAgeGate()`

Assembles the workspace's effective pnpm release-age gate from inline
`pnpm-workspace.yaml` keys and the replayed config-dependency hooks,
strictest-wins via `ReleaseAgeGate.combine`, in the same single memoized
assembly pass as `set()`:

```ts
import { WorkspaceCatalogs } from "@effected/workspaces";

const program = Effect.gen(function* () {
	const catalogs = yield* WorkspaceCatalogs;
	const gate = yield* catalogs.releaseAgeGate();
	// gate.ageMinutes, gate.exclude
});
```

A present-but-malformed inline `minimumReleaseAge` or
`minimumReleaseAgeExclude` now fails typed as `CatalogAssemblyError`
(`source: "manifest"`) instead of being silently ignored — a silently-dropped
gate is exactly the "install refuses a version the resolver already picked"
bug this vocabulary exists to prevent. A workspace with no
`pnpm-workspace.yaml` (a bun/npm workspace) has no release-age keys, so the
gate is the inert zero gate. `HookInjection` is exported from the package.
