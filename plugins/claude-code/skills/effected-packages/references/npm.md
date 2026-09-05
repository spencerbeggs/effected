# @effected/npm

Effect service **contracts** (not implementations) for resolving pnpm `catalog:`/`workspace:` dependency specifiers, the one-call `Manifest` projection built on those contracts, plus the shared npm dependency vocabulary (specifier taxonomy, dependency-section literals, integrity-hash brand) used across the kit's manifest/lockfile/workspace packages — **and**, since the 2026-07-25 extension, the registry/publish half: `NpmRegistry` (reads over core `HttpClient`) and `PackagePublish` (the npm CLI over `@effected/commands`). Boundary tier, deliberately — IO goes through core contracts required in `R`; the contracts/vocabulary half stays pure with one pure edge on `@effected/semver`.

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

## The registry/publish half

Depth — the doubles, the auth/nerf-dart mechanics, the digest pair, the executor, the age gate — lives in the `release-and-publish` skill; this is the member list:

- **`NpmRegistry`** — `Context.Service` over core `HttpClient`: `version(name, version, target?)` → `Effect<Option<PublishedVersion>, RegistryReadError>` (a `github-packages` target reads through the whole packument — GitHub Packages answers the per-version endpoint 405 regardless of credentials — and a 405 from any other registry falls back the same way), `versions`, `distTags`, `publishTimes`. A 404 is `Option.none()`/empty, never an error. Doubles: `layerTest(overrides?)` (dies loudly) and `layerSeeded(seed)` (a working fake keyed registry→name→version).
- **`PackagePublish`** — the npm CLI through `@effected/commands`' `Run`: `setupAuth` (a `RegistryCredential` to a caller-supplied npmrc, never argv — `{ kind: "token" }` writes `_authToken`, `{ kind: "basic", encoded }` writes `_auth`; the same union `RegistryTarget.credential` takes, so a probe and a publish cannot disagree about the scheme), `pack` → `PackedTarball` (`integrity` SRI + `sha256Hex` attestation subject — not interchangeable), `publishTarball` → `PublishOutcome` (`provenanceUrl?: string | undefined`, plain optional — npm's transparency-log URL when provenance published), `dryRun` → `DryRunOutcome` (`ok: false` is a result, not an error). Errors: `PublishError`, `kind: "auth" | "pack" | "publish" | "output" | "digest" | "executor"`.
- **`PackageTarball`** — the INBOUND half of the registry surface, and the answer to "read something out of a published package before any install has run". `Context.Service`; `extract(published: PublishedVersion)` → `Effect<string, TarballError, Scope>` answering the directory the tarball's `package/` root unpacked into, **scoped** so the temp directory dies with the calling scope. Takes an already-resolved `PublishedVersion` (from `NpmRegistry.version`), so it needs no `NpmRegistry` edge. `TarballError.reason` is discriminated — `notFound | http | integrityMismatch | extractFailed` — and the `notFound` split is load-bearing: a consumer that cannot tell "this version does not exist" from "something went wrong fetching one that does" routes both the same way, which silently downgraded a merge and dropped a user's override on a run that reported success. **Integrity is verified BEFORE extraction** and a non-2xx is caught before anything reaches disk (a 404 body piped to `tar` surfaces as a misleading "could not extract"). Unpacks by shelling out to `tar` through core's `ChildProcessSpawner` — a TIER decision, not convenience: a tarball-reader dependency would make this package *integrated* and drag pure `@effected/lockfiles` with it. Loading the extracted entry is deliberately NOT here (a kit-level `import()` of a computed path hands every bundling consumer a context-module problem); pair it with `resolveEntryPoint` from `@effected/package-json`.
- **`RegistryCredential`** — how BOTH halves authenticate, as one closed union: `{ kind: "token", token }` (npmrc `_authToken`, HTTP `Bearer`) | `{ kind: "basic", encoded }` (npmrc `_auth`, HTTP `Basic`). The basic arm holds the **already-encoded** blob, not a username/password pair, because npm assigns an `_auth` value straight to the `Authorization` header with no decode and real registry configuration already stores one; `basicCredentialFromPair(username, password)` is the convenience on top and throws a `RangeError` on a colon in the username. One union on both halves is the point — a probe and a publish disagreeing about the scheme make a 401 read as "not published". `RegistryTarget.token` survives one minor typed **`never`** as a deprecated tripwire, NOT an alias: deleting it outright is a *silent* break, since callers pass it through a conditional spread and a spread of an unknown property is not an excess-property error.
- **Registry label projections** — `registryShortLabel(registry)` (`npm | github | jsr | <host>`), `registryDisplayName(registry)` (`npm | GitHub Packages | JSR | <host>`), `registryHost(registry)` (host WITH port). Functions over the registry string rather than a `RegistryKind` lookup table, because `"custom"` has no fixed label — it renders as its own host. `registryShortLabel` takes a plain `string` deliberately; only the display name accepts a nullish value.
- **`NpmExecutor.withCacheDir(dir)` / `.withExtraArgs(args)`** — splice `--cache <dir>` and extra flags into every generated invocation, ambient and `dlx` alike. `withCacheDir` names the recurring runner-hygiene problem: GitHub's macOS images ship a partially root-owned `~/.npm/_cacache` and npm hard-fails `EACCES` before doing any work. **A `--cache` flag outranks `npm_config_cache` and npmrc**, so an unconditional call overrides a deliberately warmed cache — the combinator reads no environment and the caller makes that check. A copy keeps the pin, so redirecting the cache cannot degrade a `dlx` executor to ambient npm.
- **`NpmExecutor`** — which npm runs: `NpmExecutor.ambient` or `NpmExecutor.dlx("npm@11")` through `LocalExec.applyDlx`; `dlx` with no project-local launcher fails typed rather than degrading to the ambient npm.
- **`RegistryKind` / `classifyRegistry(registry?)`** — `"npm" | "github-packages" | "jsr" | "custom"`; absent classifies as `"npm"`; subdomain matching requires a leading dot.
- **`ReleaseAgeGate` / `PartialReleaseAgeGate`** — pnpm-parity publish-age gating: `combine` (the single clamping authority), `matchesExclude`/`isExcluded` (`@pnpm/matcher` parity — `*` crosses `/`, deliberately NOT `@effected/glob`'s dialect), `filterVersions`.
- **`PackageManagerPin`** — a `Schema.Class` pinning one package manager to an exact version (`PackageManagerPinName`: `npm | pnpm | yarn | bun`; `InvalidPackageManagerPinError` on a malformed pin). A plain value, not a service — costs nothing in `R`. Consumed by `@effected/github-actions`'s `PackageManagerInstaller` as the argument to `install`, confined to that one module by the reachability suite (see `actions-cache-and-artifacts`).
- **`PackageManagerCache`** — `CachingPackageManager` (`npm | pnpm | yarn-classic | yarn-berry | bun` — yarn is two rows because the cache location differs by major and a bare `yarn` name doesn't say which), `DefaultCacheDirectoryOptions`: a pure fact table answering "where does manager X cache by default on platform Y," each row cited against the manager's own authority. Replaces shelling `npm config get cache` / `pnpm store path` per run for a value that is always the default on a freshly provisioned machine.

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

For the contracts half: the `.noop` layers and `Default`, which are exactly what tests usually want. For the registry/publish half: `NpmRegistry.makeTest`/`.layerTest` and `PackagePublish.makeTest`/`.layerTest` (unstubbed members die naming themselves), plus `NpmRegistry.layerSeeded(seed)` — a working fake; `layerSeeded({ registries: {} })` is the "everything absent" registry.

## Gotchas

- An unmatched specifier is `Option.none()`, **not** an error — `DependencyResolutionError`/`CatalogAssemblyError` mean the resolution mechanism (or catalog assembly) itself failed. Do not catch a `None` as a failure.
- This package ships no real resolution logic. For actual pnpm catalog/workspace resolution, provide the real layers from `@effected/workspaces` (`Workspaces.resolvers`).
- Reuse the exported `Default`/`.noop` consts — they are memoization-stable by reference.
- `Manifest` is the tolerant, catalog/workspace-resolving projection for an ARBITRARY manifest record; `@effected/package-json`'s `Package.resolve` is the strict, typed equivalent over a validated `Package` model. Pick `Manifest` when you don't (yet) have — or don't want to require — a strict decode.
- Three distinct error types can all mean "this didn't resolve to a concrete version," for different reasons: `CatalogAssemblyError` (the catalogs couldn't even be read), `DependencyResolutionError` (the resolver mechanism failed for some other reason), `UnresolvedDependencyError` (the mechanism worked, but came back `None` for a specifier `Manifest.resolve()` needed an answer for).
