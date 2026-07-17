# @effected/npm

Effect service **contracts** (not implementations) for resolving pnpm `catalog:`/`workspace:` dependency specifiers, the one-call `Manifest` projection built on those contracts, plus the shared npm dependency vocabulary (specifier taxonomy, dependency-section literals, integrity-hash brand) used across the kit's manifest/lockfile/workspace packages. Pure tier: no IO, one pure edge on `@effected/semver`.

## Import

```ts
import { CatalogResolver, Default, DependencySpecifier, Manifest, WorkspaceResolver } from "@effected/npm";
```

Single entrypoint; no subpaths.

## Core API

- **`CatalogResolver`** — `Context.Service`: `rangeOf(packageName, catalog: Option<string>)` → `Effect<Option<string>, CatalogAssemblyError | DependencyResolutionError>` (`Option.none()` for `catalog` selects the default catalog; an unmatched name is `Option.none()`, not either error). Ships `CatalogResolver.noop`.
- **`WorkspaceResolver`** — `Context.Service`: `versionOf(packageName)` → `Effect<Option<string>, DependencyResolutionError>`. Ships `WorkspaceResolver.noop`.
- **`CatalogAssemblyError`** — raised when the catalogs THEMSELVES cannot be assembled (an unreadable/malformed `pnpm-workspace.yaml`, a malformed catalog block, a config-dependency `pnpmfile.cjs` load/replay failure) — `source: "manifest" | "catalog" | "hooks"`, `path`, `cause`. Distinct from `DependencyResolutionError`, which covers any OTHER resolution-mechanism failure; a *missing* `pnpm-workspace.yaml` or absent/`null` `workspaces` field is not an error at all — assembly yields the empty set.
- **`Default`** — `Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)`: lets a consumer type-check against the contracts while resolving nothing.
- **`Manifest`** — a tolerant `Schema.Class` domain model over a package.json-shaped record: the four dependency maps typed as `string→string` records, everything else preserved verbatim in `rest`. Deliberately NOT a strict package.json model (use `@effected/package-json`'s `Package` for that) — the input is an arbitrary user manifest mid-build, and a strict decode would reject shapes this module has no business validating. `Manifest.decode(input: unknown)` → `Effect<Manifest, ManifestDecodeError>` normalizes any schema failure at the boundary; `Manifest.schema` is the tolerant wire codec. Instance members: `get needsResolution` (pure fast-path predicate — does any dependency field carry a `catalog:`/`workspace:` specifier?), `resolve()` → `Effect<Manifest, CatalogAssemblyError | DependencyResolutionError | UnresolvedDependencyError, CatalogResolver | WorkspaceResolver>` (projects every `catalog:` specifier through `CatalogResolver`, every `workspace:` specifier through `WorkspaceResolver` + the pnpm publish-time alias projection — a `workspace:<name>@<range>` alias resolves the TARGET's version and rewrites to `npm:<name>@<range>` — everything else passes through untouched; returns a NEW `Manifest`, never mutates), `toRecord()` (encodes back to a plain record, `rest` flattened to the top level).
- **`UnresolvedDependencyError`** — raised by `Manifest.resolve()` when a `catalog:`/`workspace:` specifier resolves to nothing (the catalog has no entry, or no workspace package carries the name): `field`, `dependency`, `specifier`, `reason: "catalog-entry-missing" | "workspace-package-missing"`. Distinct from `DependencyResolutionError` — the resolution MECHANISM worked; the answer was `Option.none()`, which at the manifest level means the projection cannot complete.
- **`DependencySpecifier`** — branded string with an eleven-protocol classification (`range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`) and a `FromString` codec decoding to a five-case tagged union (`CatalogSpecifier | WorkspaceSpecifier | RangeSpecifier | DistTagSpecifier | RawSpecifier`) that encodes back byte-for-byte. Statics beyond the codec: `protocolOf(value)` (classify without decoding), `isRange`/`isTag`/`isGit`/`isUrl`/`isLocal`/`isLink`/`isPortal`/`isCatalog`/`isWorkspace` (per-protocol boolean checks), `parseRange(value)` → `Option<Range>` (from `@effected/semver`), `catalogNameOf(specifier)` → `Option<string>`, `workspaceTargetOf(specifier)` → `Option<string>` (the alias target of a `workspace:<name>@<range>` form), `resolveWorkspace(specifier, version)` (projects a `workspace:` specifier to its published form given a concrete version — the same projection `Manifest.resolve()` applies internally), `isValid`, `decode(input)` → `Effect<DependencySpecifierBrand, InvalidDependencySpecifierError>`.
- **`DependencySection`** — `DependencyKind` (`prod`/`dev`/`peer`/`optional`) and `DependencyField` literals with bidirectional `fieldOf`/`kindOf`.
- **`IntegrityHash`** — brand covering SRI (`<algo>-<base64>`), corepack (`<algo>.<hex>`) and yarn (`10c0/<hex>`) forms; `algorithmOf`, `isSri`/`isCorepack`/`isYarnChecksum`/`isValid`, `decode(input)` → `Effect<IntegrityHashBrand, InvalidIntegrityHashError>`.

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

The one-call manifest projection — decode an arbitrary parsed manifest, skip resolution entirely when nothing needs it, and project the rest:

```ts
import { Default, Manifest } from "@effected/npm";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const manifest = yield* Manifest.decode({ name: "app", dependencies: { effect: "^4.0.0" } });
  // A manifest with catalog:/workspace: specifiers sets needsResolution, and
  // resolving THOSE needs real resolver layers (@effected/workspaces'
  // Workspaces.resolvers) — under the no-op Default layers every lookup is
  // Option.none() and resolve() fails typed as UnresolvedDependencyError.
  const resolved = manifest.needsResolution ? yield* manifest.resolve() : manifest;
  return resolved.toRecord();
});

Effect.runPromise(Effect.provide(program, Default));
```

## Testing machinery

None exported beyond the `.noop` layers and `Default`, which are exactly what tests usually want.

## Gotchas

- An unmatched specifier is `Option.none()`, **not** an error — `DependencyResolutionError`/`CatalogAssemblyError` mean the resolution mechanism (or catalog assembly) itself failed. Do not catch a `None` as a failure.
- This package ships no real resolution logic. For actual pnpm catalog/workspace resolution, provide the real layers from `@effected/workspaces` (`Workspaces.resolvers`).
- Reuse the exported `Default`/`.noop` consts — they are memoization-stable by reference.
- `Manifest` is the tolerant, catalog/workspace-resolving projection for an ARBITRARY manifest record; `@effected/package-json`'s `Package.resolve` is the strict, typed equivalent over a validated `Package` model. Pick `Manifest` when you don't (yet) have — or don't want to require — a strict decode.
- Three distinct error types can all mean "this didn't resolve to a concrete version," for different reasons: `CatalogAssemblyError` (the catalogs couldn't even be read), `DependencyResolutionError` (the resolver mechanism failed for some other reason), `UnresolvedDependencyError` (the mechanism worked, but came back `None` for a specifier `Manifest.resolve()` needed an answer for).
