# @effected/npm

## 0.8.0

### Features

* `PackageManagerCache.defaultDirectory(manager, { platform, home })` is a
  pure, no-IO facts table answering where each package manager caches by
  default: `npm`, `pnpm`, `yarn-classic`, `yarn-berry` (split from a bare
  `yarn` because the two majors document different cache locations) and
  `bun`. Every cell is verified against the manager's own documentation or
  source, cited on the member — two of the three rows this replaces in prior
  art were wrong (pnpm's macOS store is not the Linux XDG path, and yarn
  Classic's cache was never `~/.yarn/cache`).

````ts
import { PackageManagerCache } from "@effected/npm";

PackageManagerCache.defaultDirectory("pnpm", { platform: "darwin", home: "/Users/ci" });
// => "/Users/ci/Library/pnpm/store"
``` [#219](https://github.com/spencerbeggs/effected/pull/219) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!

## 0.7.0

### Features

* ### `sha224` recognized as a valid integrity algorithm

  `IntegrityAlgorithm` and `IntegrityHash`'s corepack-form regex now accept `sha224`, matching corepack's own transparent default pins (e.g. `yarn@4.x+sha224.<hex>`). The SRI form is unaffected — the SRI specification itself never includes `sha224`.

  ### `CorepackIntegrityHash`

  `IntegrityHash` narrowed to the corepack `<algo>.<hex>` form only — an SRI (`sha512-<base64>`) or yarn (`10c0/<hex>`) hash, both otherwise-valid `IntegrityHash` values, fails this schema. It decodes to the same brand `IntegrityHash` does, so a corepack-validated value assigns anywhere an `IntegrityHash` is expected.

  ```ts
  import { CorepackIntegrityHash } from "@effected/npm";
  import { Schema } from "effect";

  const decode = Schema.decodeUnknownExit(CorepackIntegrityHash);

  decode("sha512.deadbeef"); // success
  decode("sha512-3q2+7w=="); // failure — SRI form
````

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### `PackageManagerPin`

A new schema for the corepack pin grammar itself — `<name>@<version>[+<integrity>]`, closed to the four package managers the kit can provision (`npm`, `pnpm`, `yarn`, `bun`) via `PackageManagerPinName`. Consumed by `@effected/github-actions`' `PackageManagerInstaller` to provision an exact package-manager version on a runner, and shares its version and integrity schemas with `@effected/package-json`'s `PackageManager` field model. [#215][#215]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.6.0

### Breaking Changes

* `PublishOutcome.provenanceUrl` is now a plain optional field instead of an
  `Option.Option<string>`. Read it as `outcome.provenanceUrl` (possibly
  `undefined`), not `Option.getOrUndefined(outcome.provenanceUrl)`.

  ```ts
  // Before
  const url = Option.getOrUndefined(outcome.provenanceUrl);

  // After
  const url = outcome.provenanceUrl;
  ```

### Bug Fixes

* `NpmRegistry.version` now reads a `github-packages` target through the
  packument instead of the per-version endpoint. GitHub Packages answers the
  per-version route with `405` regardless of credentials, so a lookup against a
  GitHub Packages registry previously failed outright. Any other registry that
  answers `405` on the per-version path is retried the same way, so the fix is
  not GitHub-specific. [#191][#191]

### Dependencies

| Dependency         | Type       | Action  | From  | To    |
| ------------------ | ---------- | ------- | ----- | ----- |
| @effected/commands | dependency | updated | 0.1.0 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.5.0

### Features

* ### `NpmRegistry` — registry reads over `HttpClient`

  `version` / `versions` / `distTags` / `publishTimes`, each taking a per-call
  `RegistryTarget` (`{ registry?, token? }`) so one program can probe two
  registries for the same package. A 404 decodes to `Option.none()` rather than
  being classified from response text. Test doubles: `NpmRegistry.layerTest`
  (unstubbed members die) and `NpmRegistry.layerSeeded` (a working fake keyed by
  `registries[registry][name][version]`).

  ### `PackagePublish` — pack and publish over `@effected/commands`

  `setupAuth` / `pack` / `publishTarball` / `dryRun`. The auth token is written
  to a caller-supplied `.npmrc` path, never passed as an argv flag. `pack`
  reports both an SRI `integrity` digest (compares against the registry) and a
  local `sha256Hex` digest (the attestation subject) — the two are not
  interchangeable. A failed `dryRun` is a result, not a thrown error.

  ### `NpmExecutor` — ambient npm or a pinned `dlx`

  `NpmExecutor.ambient` or `NpmExecutor.dlx(spec)`, replacing repeated
  `packageManager?:` options scattered across call sites. With no launcher
  configured it fails typed rather than silently degrading to whatever `npm` is
  on `PATH`.

  ### `RegistryKind` and `PublishError`

  `classifyRegistry` sorts a registry URL into `npm | github-packages | jsr |
  custom` — subdomain matching requires a leading dot, so a lookalike host is
  never mistaken for the real registry. `PublishError` carries `kind: auth |
  pack | publish | output | digest | executor`.

### Bug Fixes

* `PackagePublish` now extends the parent environment when passing caller
  environment variables to a spawned `npm`/`pnpm` process, rather than replacing
  it — a hermetic environment previously left the child unable to resolve its
  own executable through `PATH`. [#180][#180]

### Dependencies

| Dependency         | Type       | Action  | From  | To    |
| ------------------ | ---------- | ------- | ----- | ----- |
| @effected/commands | dependency | updated | 0.0.0 | 0.1.0 |

* | Dependency         | Type       | Action | From | To    |                                                                       |
  | ------------------ | ---------- | ------ | ---- | ----- | --------------------------------------------------------------------- |
  | @effected/commands | dependency | added  | —    | 0.0.0 | [#180][#180] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.4.0

### Breaking Changes

* ### `ReleaseAgeGate.combine` returns a sorted exclude union

  The combined gate previously preserved the order in which exclude patterns were contributed. It now returns them deduplicated and lexicographically sorted, so the union is a canonical value that does not depend on the order the contributions arrived in.

  Assertions written against an insertion-ordered union need updating:

  ```ts
  const combined = ReleaseAgeGate.combine({ exclude: ["c", "b"] }, { exclude: ["b", "a"] });

  // before — order followed the contributions
  assert.deepStrictEqual(combined.exclude, ["c", "b", "a"]);

  // after — canonical order, whichever way the gates were combined
  assert.deepStrictEqual(combined.exclude, ["a", "b", "c"]);
  ```

  Consumers that only call `isExcluded` or `filterVersions` are unaffected. [#175][#175]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.3.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.0 | 0.2.1 |

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.3.0

### Features

* ### `ReleaseAgeGate` / `PartialReleaseAgeGate`

  Adds shared vocabulary for pnpm's publish-time release-age gate — the
  `minimumReleaseAge` / `minimumReleaseAgeExclude` config pnpm uses to refuse
  installing a version younger than a cutoff
  (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`). A resolver that picks the highest
  in-range version with no publish-time awareness can pick a version pnpm then
  rejects; mirroring the gate at resolution time avoids that.

  ```ts
  import { ReleaseAgeGate } from "@effected/npm";

  const gate = ReleaseAgeGate.combine({ ageMinutes: 1440 }, { exclude: ["@my-scope/*"] });

  const eligible = gate.filterVersions(
  	["1.0.0", "1.0.1"],
  	{ "1.0.0": "2020-01-01T00:00:00Z", "1.0.1": "2026-07-21T00:00:00Z" },
  	"prettier",
  	Date.now(),
  );
  ```

  `ReleaseAgeGate.combine` merges partial contributions from multiple config
  sources strictest-wins: the maximum of the contributed ages (clamped
  non-negative), and the exclude sets unioned. `matchesExclude` mirrors pnpm's
  own `@pnpm/matcher` name-matching semantics — a `*`-glob crosses `/`, unlike
  `@effected/glob`'s minimatch dialect — so `isExcluded` and `filterVersions`
  behave exactly like pnpm's own gate. `filterVersions` takes the caller's
  clock; a version with a missing or unparseable publish timestamp is dropped,
  matching pnpm's strict posture. [#139][#139]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/effected/pull/139

## 0.2.3

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.2.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.1.1 | 0.2.0 |

## 0.2.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.1.0 | 0.1.1 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.2.0

### Breaking Changes

* ### `CatalogResolver.rangeOf` error channel widened

  `CatalogResolver.rangeOf` can now fail with `CatalogAssemblyError` in addition to `DependencyResolutionError`. A resolver implementation that fails to assemble its catalogs (an unreadable or malformed catalog source) now surfaces that failure typed, rather than folding it into a `DependencyResolutionError` defect. Code that pattern-matches on the error channel (`Effect.catchTag`/`Effect.catchTags`) needs to add a case for `CatalogAssemblyError`:

  ```ts
  import { CatalogResolver } from "@effected/npm";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const resolver = yield* CatalogResolver;
  	return yield* resolver.rangeOf("effect", Option.none());
  }).pipe(
  	Effect.catchTags({
  		CatalogAssemblyError: (error) => Effect.logError(`catalog assembly failed: ${error.message}`),
  		DependencyResolutionError: (error) => Effect.logError(`resolution failed: ${error.message}`),
  	}),
  );
  ```

### Features

* ### `Manifest` — a tolerant manifest model

  A new `Manifest` `Schema.Class` models a mid-build manifest: the four dependency fields (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) are typed as string→string records, and every other top-level field is preserved verbatim in `rest` (flattened back to the top level on encode — no literal `rest` key on the wire). Unlike `@effected/package-json`'s strict `Package`, `Manifest.decode` only validates the four dependency fields, so it never rejects a manifest for a field this module has no business validating.

  ```ts
  import { Default, Manifest } from "@effected/npm";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const manifest = yield* Manifest.decode({ name: "app", dependencies: { effect: "^4.0.0" } });
  	const resolved = manifest.needsResolution ? yield* manifest.resolve() : manifest;
  	return resolved.toRecord();
  });

  Effect.runPromise(Effect.provide(program, Default)).then(console.log);
  // => { dependencies: { effect: "^4.0.0" }, name: "app" }
  ```

  * `Manifest.decode(input)` normalizes any `SchemaError` to a typed `ManifestDecodeError`.
  * `manifest.needsResolution` is a pure fast-path check: does any dependency field carry a `catalog:` or `workspace:` specifier?
  * `manifest.resolve()` projects every such specifier to a concrete range through `CatalogResolver` / `WorkspaceResolver`, returning a new `Manifest`. A specifier the resolvers cannot answer fails typed as `UnresolvedDependencyError`; mechanism failures surface as `CatalogAssemblyError` / `DependencyResolutionError`.
  * `manifest.toRecord()` encodes back to the wire shape.

  ### `CatalogAssemblyError` now lives here

  `CatalogAssemblyError` moved from `@effected/workspaces` to `@effected/npm`, next to the `CatalogResolver` contract that names it in its error channel. Import it from `@effected/npm` going forward.

  ### New `DependencySpecifier` statics and `WorkspaceSpecifier#resolve`

  `DependencySpecifier` gains statics covering the pnpm publish-time projection for `workspace:` specifiers, including the alias form:

  ```ts
  import { DependencySpecifier } from "@effected/npm";

  DependencySpecifier.catalogNameOf("catalog:react18"); // Some("react18")
  DependencySpecifier.catalogNameOf("catalog:"); // None (default catalog)

  DependencySpecifier.resolveWorkspace("workspace:^", "1.2.3"); // "^1.2.3"
  DependencySpecifier.resolveWorkspace("workspace:foo@*", "1.2.3"); // "npm:foo@1.2.3" (alias form)

  DependencySpecifier.workspaceTargetOf("workspace:foo@^1.0.0"); // Some("foo")
  DependencySpecifier.workspaceTargetOf("workspace:*"); // None (plain form)
  ```

  `WorkspaceSpecifier#resolve(version)` applies the same projection to an already-classified instance from `DependencySpecifier.FromString`, sharing one implementation with the `resolveWorkspace` static. [#83][#83]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#83]: https://github.com/spencerbeggs/effected/pull/83

## 0.1.0

### Features

* Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers, plus the kit-wide dependency vocabulary. `CatalogResolver.rangeOf` turns a package name plus an optional catalog name into the configured range; `WorkspaceResolver.versionOf` turns a workspace package name into its concrete version. Both are `Context.Service` contracts shipping a no-op default layer, and neither reads a file — the package is the seam, and something that can see the workspace supplies the implementation. An unmatched specifier is `Option.none()`, not an error; the error channel is reserved for the resolution mechanism failing.

  ### Resolver contracts

  The `Default` layer merges both no-op resolvers. Provide it when the contracts need satisfying but nothing should resolve.

  ```ts
  import { CatalogResolver, Default, WorkspaceResolver } from "@effected/npm";
  import { Effect, Option } from "effect";

  const program = Effect.gen(function* () {
    const catalog = yield* CatalogResolver;
    const workspace = yield* WorkspaceResolver;
    return yield* Effect.all([
      catalog.rangeOf("effect", Option.none()),
      workspace.versionOf("@effected/semver"),
    ]);
  });

  Effect.runPromise(Effect.provide(program, Default)).then(console.log);
  // => [Option.none(), Option.none()]
  ```

  A real resolver is a `Layer.succeed` over the shape — `@effected/workspaces` implements these against a discovered monorepo, but a fixed record is a legitimate implementation for a test or a tool that already knows its own catalog. Both contracts raise `DependencyResolutionError`, carrying the `specifier` and a structural `cause`.

  ### Dependency vocabulary

  The package also holds the shared vocabulary second consumers pulled in: `DependencySpecifier` (a branded string with an eleven-protocol taxonomy and a `FromString` codec decoding to a `ClassifiedSpecifier` union that re-encodes byte-for-byte), `DependencySection` (`DependencyKind` / `DependencyField` with the bidirectional `fieldOf` / `kindOf` mapping), and `IntegrityHash` (a brand over the SRI, corepack and yarn textual forms). [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
