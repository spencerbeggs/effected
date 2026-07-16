---
"@effected/npm": minor
---

## Breaking Changes

### `CatalogResolver.rangeOf` error channel widened

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

## Features

### `Manifest` — a tolerant manifest model

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

- `Manifest.decode(input)` normalizes any `SchemaError` to a typed `ManifestDecodeError`.
- `manifest.needsResolution` is a pure fast-path check: does any dependency field carry a `catalog:` or `workspace:` specifier?
- `manifest.resolve()` projects every such specifier to a concrete range through `CatalogResolver` / `WorkspaceResolver`, returning a new `Manifest`. A specifier the resolvers cannot answer fails typed as `UnresolvedDependencyError`; mechanism failures surface as `CatalogAssemblyError` / `DependencyResolutionError`.
- `manifest.toRecord()` encodes back to the wire shape.

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

`WorkspaceSpecifier#resolve(version)` applies the same projection to an already-classified instance from `DependencySpecifier.FromString`, sharing one implementation with the `resolveWorkspace` static.
