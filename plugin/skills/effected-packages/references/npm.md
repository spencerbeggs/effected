# @effected/npm

Effect service **contracts** (not implementations) for resolving pnpm `catalog:`/`workspace:` dependency specifiers, plus the shared npm dependency vocabulary (specifier taxonomy, dependency-section literals, integrity-hash brand) used across the kit's manifest/lockfile/workspace packages. Pure tier: no IO, one pure edge on `@effected/semver`.

## Import

```ts
import { CatalogResolver, Default, DependencySpecifier, WorkspaceResolver } from "@effected/npm";
```

Single entrypoint; no subpaths.

## Core API

- **`CatalogResolver`** — `Context.Service`: `rangeOf(packageName, catalog: Option<string>)` → `Effect<Option<string>, DependencyResolutionError>` (`Option.none()` for `catalog` selects the default catalog). Ships `CatalogResolver.noop`.
- **`WorkspaceResolver`** — `Context.Service`: `versionOf(packageName)` → `Effect<Option<string>, DependencyResolutionError>`. Ships `WorkspaceResolver.noop`.
- **`Default`** — `Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)`: lets a consumer type-check against the contracts while resolving nothing.
- **`DependencySpecifier`** — branded string with an eleven-protocol classification (`range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`) and a `FromString` codec decoding to a five-case tagged union (`CatalogSpecifier | WorkspaceSpecifier | RangeSpecifier | DistTagSpecifier | RawSpecifier`) that encodes back byte-for-byte.
- **`DependencySection`** — `DependencyKind` (`prod`/`dev`/`peer`/`optional`) and `DependencyField` literals with bidirectional `fieldOf`/`kindOf`.
- **`IntegrityHash`** — brand covering SRI (`<algo>-<base64>`), corepack (`<algo>.<hex>`) and yarn (`10c0/<hex>`) forms; `algorithmOf`.

## Usage

```ts
import { CatalogResolver, Default } from "@effected/npm";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
 const catalog = yield* CatalogResolver;
 return yield* catalog.rangeOf("effect", Option.none());
});
Effect.runPromise(Effect.provide(program, Default)); // Option.none()
```

## Testing machinery

None exported beyond the `.noop` layers and `Default`, which are exactly what tests usually want.

## Gotchas

- An unmatched specifier is `Option.none()`, **not** an error — `DependencyResolutionError` means the resolution mechanism itself failed. Do not catch a `None` as a failure.
- This package ships no real resolution logic. For actual pnpm catalog/workspace resolution, provide the real layers from `@effected/workspaces` (`Workspaces.resolvers`).
- Reuse the exported `Default`/`.noop` consts — they are memoization-stable by reference.
