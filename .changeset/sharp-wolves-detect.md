---
"@effected/workspaces": minor
---

## Breaking Changes

### `PublishabilityDetector` no longer has an ambient default

The bare `PublishabilityDetector.layer` is **removed**. `Workspaces.layer`,
`layerWithGit` and `layerWithConfigDependencies` now all **require**
`PublishabilityDetector` in `R` instead of silently supplying npm semantics —
the old default made `Layer.mergeAll(myDetector, Workspaces.layer())` resolve
to the default rather than the override, because `mergeAll` is last-wins, with
no type error to catch it.

Provide a policy explicitly:

```ts
import { PublishabilityDetector, Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));
```

`PublishabilityDetector.layerNpm` replaces the old `.layer` (standard npm
semantics); `PublishabilityDetector.layerNone` is a workspace where nothing
publishes. Each is also exposed as a plain value — `PublishabilityDetector.npm`
/ `.none` — for composing a policy that defers to one of them.

### `ReleaseTag`'s default version prefix is now `""`

`ReleaseTag.single` / `ReleaseTag.scoped` default `versionPrefix` to `""`
(strict SemVer) uniformly, rather than defaulting unscoped package names to a
`"v"` prefix. A consumer relying on the old `v`-prefixed tags for an unscoped
package must now pass `versionPrefix: "v"` explicitly.

## Features

### `ReleaseTag` and `TrackingTag`

`ReleaseTag.single` / `.scoped` format a release's git tag name.
`TrackingTag.forVersion` derives the floating-alias tags a version should
carry (`v1`, `v1.2`) and never floats onto a prerelease; `TrackingTag.classifyTag`
tells a version tag from an alias tag by segment count.

### `VersioningStrategy`

`VersioningStrategy.classify` / `.detect` / `.tagsFor` — classify a package's
versioning shape and compute the tags a release should push.

### `PackageManagerDetector` gains a standalone and declaration tier

Detection now runs three tiers: workspace markers, then a standalone tier
(lockfile presence with no workspace config), then a declaration tier
(`packageManager` / `devEngines.packageManager` with no lockfile at all — a
fresh clone before its first install). `PackageManagerDetector.makeTest` /
`layerTest` are the sanctioned test doubles; an unstubbed `detect` dies rather
than guessing.

### `localExecLayer` implements `@effected/commands`' `LocalExec`

`Workspaces.localExecLayer` teaches `@effected/commands`' `ToolDiscovery` how
to run a workspace's own package-manager binaries, resolving against the
workspace root rather than the caller's `cwd`.

`Workspaces` is now a static class rather than an `as const` namespace object;
call syntax (`Workspaces.layer(...)`) is unchanged.
