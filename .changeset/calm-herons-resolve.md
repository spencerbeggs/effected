---
"@effected/npm": minor
---

## Features

Initial release of `@effected/npm` — pure-tier Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers, spun out of the `@effected/package-json` port. No IO, no parsing, no recursion — just the resolution contracts a package.json-document library defines but cannot implement:

```ts
import { CatalogResolver, Default, WorkspaceResolver } from "@effected/npm";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
	const catalog = yield* CatalogResolver;
	const range = yield* catalog.rangeOf("effect", Option.none());
	console.log(Option.isNone(range)); // true — the no-op default resolves nothing
}).pipe(Effect.provide(Default));
```

### CatalogResolver and WorkspaceResolver

* `CatalogResolver.rangeOf(packageName, catalog: Option<string>)` — resolves a `catalog:` specifier to its configured range, or `Option.none()` if it cannot be resolved.
* `WorkspaceResolver.versionOf(packageName)` — resolves a `workspace:` specifier to its concrete version, or `Option.none()` if it cannot be resolved.
* Both ship a pure no-op `.noop` default layer that resolves nothing, so a consumer (e.g. `@effected/package-json`'s `Package.resolve`) type-checks with zero configuration; a real implementation is provided at the application boundary.
* `Default` — a composite layer merging both no-op resolvers, for the common case of wanting the contracts satisfied without resolving anything.

### DependencyResolutionError

`Schema.TaggedErrorClass` raised by both resolver contracts when a specifier cannot be resolved. Carries `specifier: string` and a structured `cause: Schema.Defect` — never a stringified message — so callers can branch on the underlying failure.
