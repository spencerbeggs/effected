# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas. Integrated tier: it carries one real external runtime dependency (`spdx-expression-parse` for SPDX license validation) plus `@effected/npm` and `@effected/semver`.

## Import

```ts
import { Package, PackageJsonFile, PackageValidator } from "@effected/package-json";
```

Single entrypoint; no subpaths.

**Platform**: the `Package` model is pure; `PackageJsonFile` needs `FileSystem` and `Path` at the edge — `@effect/platform-node` or `@effect/platform-bun` (wired in the example below).

## Feature surface

| Reach for | When |
| --- | --- |
| `Package.decode(raw)` | turn a parsed JSON value into a validated `Package` (fails `PackageDecodeError`) |
| `Package` getters (`isPrivate`, `isScoped`, `isESM`, `hasDependency`) | read computed facts off a manifest |
| `Package.getDependencies()` / `getDevDependencies()` / `getPeerDependencies()` / `getOptionalDependencies()` | the four dependency maps as `HashMap<string, Dependency>` |
| `Dependency`'s protocol getters (`.isWorkspace`, `.isCatalog`, `.isLocal`, `.isGit`, `.isRange`, `.isTag`, `.isUnresolved`) | classify one dependency entry without hand-rolling specifier parsing |
| `Package.setVersion` / `setName` / `setLicense` | validated single-field mutation (typed failure on bad input) |
| `Package.addDependency` / `removeDependency` (+ dev/peer/optional variants) / `setScript` / `removeScript` | immutable, dual-signature (data-first, curried, or piped) map edits |
| `Package.resolve(pkg)` | turn `catalog:`/`workspace:` specifiers into concrete ranges across all four maps |
| `Package.toJsonString(options?)` | serialize with canonical key order, dependency-map sorting, empty-map stripping |
| `PackageJsonFile.read` / `.write` | the one IO service, over core `FileSystem`/`Path` |
| `PackageValidator.validate` | aggregate rule-based checks into one `PackageValidationError` |
| `PackageName`, `SpdxLicense`, `PackageManager`, `Person` | leaf schemas for the corresponding raw-string fields |

## Core API

- **`Package`** — the `Schema.Class` domain model: typed known fields (`version` as `SemVer`, `license` as `SpdxLicense`, `author`/`contributors` as `Person`, `packageManager` as `PackageManager`, `devEngines` as a typed struct, dependency maps as `HashMap<string, Dependency>`) plus a `rest` catch-all that preserves unknown top-level keys through read/edit/write. `Package.decode(raw)` → `Effect<Package, PackageDecodeError>` normalizes any schema failure at the boundary. `Package.schema` is the wire codec (open JSON object ⇄ `Package`, partitioning unknown keys into `rest`); `Package.wireFor(ExtendedClass)` builds the equivalent codec for a `.extend()`ed subclass so its own fields decode as typed members instead of falling into `rest`.
- **Computed getters** — `isPrivate`, `isScoped`, `isESM`, `hasDependency(name)`, `getDependencies()`/`getDevDependencies()`/`getPeerDependencies()`/`getOptionalDependencies()` (the last carries `isOptional` from `peerDependenciesMeta`). `copyWith(patch)` returns a new `Package` with the given fields replaced, `patch` typed as `Partial<{...}>` derived straight from the schema so it can't drift.
- **Dual-signature mutation statics** — `Package.setVersion`/`setName`/`setLicense` (each fails typed: `InvalidVersionError`/`InvalidPackageNameError`/`InvalidSpdxLicenseError`); `addDependency`/`removeDependency`, `addDevDependency`/`removeDevDependency`, `addPeerDependency`/`removePeerDependency`, `addOptionalDependency`/`removeOptionalDependency`, `setScript`/`removeScript` — all pure, usable data-first (`Package.addDependency(pkg, name, specifier)`), curried (`Package.addDependency(name, specifier)(pkg)`), or piped.
- **`Dependency`** — one entry from a dependency map: `name`, `specifier`, `kind` (`"prod" | "dev" | "peer" | "optional"`), optional `isOptional`. Rich classification getters delegate to `@effected/npm`'s `DependencySpecifier`: `.protocol` (`Option<DependencyProtocol>`), `.range` (`Option<Range>` from `@effected/semver`), `.isLocal`, `.isLink`, `.isPortal`, `.isCatalog`, `.isWorkspace`, `.isUnresolved`, `.isGit`, `.isRange`, `.isTag`. `isUnresolvedDependency(dep)` is a type guard narrowing to `UnresolvedDependency` (a `Dependency & { isUnresolved: true }`).
- **`Package.resolve(pkg)`** — turns `catalog:`/`workspace:` specifiers into concrete ranges across all four dependency maps; requires `CatalogResolver | WorkspaceResolver` (contracts from `@effected/npm`) in `R` — real layers come from `@effected/workspaces`. Unresolvable specifiers are left unchanged (resolution still succeeds); a `CatalogResolver` whose catalog assembly failed surfaces `@effected/npm`'s `CatalogAssemblyError` alongside `DependencyResolutionError`. This is the explicit step — `PackageJsonFile.write` never resolves on its own.
- **`PackageFormatOptions` / `PackageIndent`** — options for both `Package.toJsonString` and `PackageJsonFile.write`. `PackageIndent = number | "tab" | "preserve"` (default `2`); `"preserve"` reuses the indentation detected from `sourceText`'s first indented line — `PackageJsonFile.write` supplies the on-disk file's own text automatically when `sourceText` is omitted, while the pure `toJsonString` falls back to the 2-space default with no source to preserve from. `sort` (default `true`) orders top-level keys to match `sort-package-json`'s canonical `sortOrder` verbatim (unknown keys append: public keys alphabetically, then `_`-prefixed) and alphabetizes each dependency map. `stripEmpty` (default `true`) drops empty dependency-map keys; `newline` (default `true`) appends a trailing newline.
- **`PackageJsonFile`** — the one IO service: `read(path)` → `Effect<Package, PackageJsonReadError | PackageJsonNotFoundError | PackageJsonParseError | PackageDecodeError>`; `write(path, pkg, options?)` → `Effect<void, PackageJsonWriteError>` over core `FileSystem`/`Path`.
- **`PackageValidator`** — `validate(pkg)` → `Effect<void, PackageValidationError>` (aggregates every rule failure — `failures: { rule, message, path }[]` — into one error). `PackageValidator.layer` runs `defaultRules` (license, description, repository, not-private); `layerRules({ rules })` swaps in a custom `ReadonlyArray<ValidationRule>`. Two individually-importable rules: `noUnresolvedDepsRule` (fails on any unresolved `workspace:`/`catalog:` specifier) and `noLocalDepsRule` (fails on `file:`/`link:`/`portal:` specifiers) — compose them into your own rule set alongside or instead of `defaultRules`.
- **Leaf schemas** — `PackageName` (scoped/unscoped, statics `isValid`/`scope`/`unscoped`/`isScoped`), `SpdxLicense` (+ `isValidSpdx`), `PackageManager` (parses `"name@version[+integrity]"`; `.hasIntegrity` getter), `Person` (parses `"Name <email> (url)"` via `Person.FromString`), `Dependency`, re-exported `DependencySpecifier` from `@effected/npm`.

## Usage

```ts
import { Package, PackageJsonFile } from "@effected/package-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
  const file = yield* PackageJsonFile;
  const pkg = yield* file.read("./package.json");
  const bumped = yield* Package.setVersion(pkg, pkg.version.bump.patch().toString());
  yield* file.write("./package.json", bumped);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(PackageJsonFile.layer),
    Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
);
```

Filtering unresolved dependencies before a publish (no IO — a plain `Package` in hand):

```ts
import { isUnresolvedDependency, Package } from "@effected/package-json";
import { HashMap } from "effect";

const unresolved = HashMap.values(pkg.getDependencies())
  .filter((dep) => dep.isUnresolved)
  .map((dep) => dep.name);
```

Validating with the default rules plus a custom one, catching the aggregated failure:

```ts
import type { ValidationRule } from "@effected/package-json";
import { defaultRules, PackageValidator } from "@effected/package-json";
import { Effect, Option } from "effect";

const requireName: ValidationRule = {
  name: "has-name",
  validate: (pkg) => (pkg.name.length > 0 ? Effect.void : Effect.fail({ message: "name is required", path: Option.none() })),
};

const program = Effect.gen(function* () {
  const validator = yield* PackageValidator;
  yield* validator.validate(pkg).pipe(
    Effect.catchTag("PackageValidationError", (e) => Effect.logWarning(e.message)),
  );
}).pipe(Effect.provide(PackageValidator.layerRules({ rules: [...defaultRules, requireName] })));
```

Preserving an existing file's indentation style on write, rather than re-flowing to the 2-space default:

```ts
import { PackageJsonFile } from "@effected/package-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const files = yield* PackageJsonFile;
  const pkg = yield* files.read("./package.json");
  // No sourceText needed here — write() reads the on-disk file's own text
  // to detect its indentation when indent: "preserve" and sourceText are both omitted.
  yield* files.write("./package.json", pkg, { indent: "preserve" });
});
```

## Testing machinery

None exported. Compose `PackageJsonFile.layer` over an in-memory or test `FileSystem` layer for hermetic tests; `PackageValidator.layerRules({ rules: [] })` gives a validator that always succeeds.

## Gotchas

- `PackageJsonFile.write` never resolves `catalog:`/`workspace:` specifiers — call `Package.resolve` first if the on-disk manifest needs concrete ranges.
- A missing file is typed `PackageJsonNotFoundError` (no TOCTOU `exists` pre-check), not a generic `PlatformError`.
- `publishConfig` is an open record (round-trips faithfully, but no typed `publishConfig.access` — read it off the raw record).
- `Schema.Class` instances are not `Pipeable` in v4; `Package` hand-rolls its own `pipe` overload.
- `toJsonString`/`write` reorder and re-sort by default (`sort: true`) — a round-trip through either, with no options, can move keys even when nothing else changed. Pass `{ sort: false }` to preserve on-disk key order verbatim.
- `indent: "preserve"` with an explicit `sourceText` ignores the on-disk file entirely — pass whichever source text's indentation you actually want reused; it need not be the file at `path`.
