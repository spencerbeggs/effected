---
"@effected/package-json": minor
---

## Breaking Changes

### `Package.resolve` error channel widened

`Package.resolve` now routes specifier classification through `@effected/npm`'s shared `DependencySpecifier` statics. Its error channel now includes `CatalogAssemblyError` alongside `DependencyResolutionError`, flowing from the widened `CatalogResolver` contract — a `CatalogResolver` whose catalog assembly failed now surfaces that failure typed instead of being swallowed into a resolution-error defect. Code that pattern-matches on `Package.resolve`'s error channel needs to add a case for `CatalogAssemblyError`:

```ts
import { Package } from "@effected/package-json";
import { Effect } from "effect";

Package.resolve(pkg).pipe(
	Effect.catchTags({
		CatalogAssemblyError: (error) => Effect.logError(`catalog assembly failed: ${error.message}`),
		DependencyResolutionError: (error) => Effect.logError(`resolution failed: ${error.message}`),
	}),
);
```

## Features

### Alias-form `workspace:` specifiers now resolve correctly

`Package.resolve` now recognizes pnpm's alias form (`workspace:<name>@<range>`), resolving the **target** package's version rather than the dependency map key's, and projecting to the published `npm:<name>@<range>` alias — matching what pnpm actually publishes. Previously this form was not specially handled and could resolve to an incorrect specifier.

### Whitespace-only catalog names now select the default catalog

A `catalog:` specifier whose name is only whitespace (e.g. `"catalog:  "`) now selects the default catalog, matching pnpm's own trimming behavior, instead of looking up a catalog literally named `"  "`.

## Bug Fixes

- The wire-codec encoder now lets typed fields win over a colliding key in `rest`, so a hand-built `Package` (or `.extend()`ed subclass) whose `rest` smuggles a known field name no longer shadows the typed member on the wire.
