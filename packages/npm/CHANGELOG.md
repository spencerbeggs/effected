# @effected/npm

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
