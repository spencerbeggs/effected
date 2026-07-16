# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas. Integrated tier: it carries one real external runtime dependency (`spdx-expression-parse` for SPDX license validation) plus `@effected/npm` and `@effected/semver`.

## Import

```ts
import { Package, PackageJsonFile, PackageValidator } from "@effected/package-json";
```

Single entrypoint; no subpaths.

**Platform**: the `Package` model is pure; `PackageJsonFile` needs `FileSystem` and `Path` at the edge — `@effect/platform-node` or `@effect/platform-bun` (wired in the example below).

## Core API

- **`Package`** — the `Schema.Class` domain model: typed known fields (`version` as `SemVer`, `license` as `SpdxLicense`, `author`/`contributors` as `Person`, dependency maps as `HashMap<string, Dependency>`) plus a `rest` catch-all that preserves unknown top-level keys through read/edit/write. Computed getters (`isPrivate`, `isScoped`, `isESM`, `hasDependency(name)`, `getDependencies()`, …) and dual-signature mutation statics (`Package.setVersion`, `Package.addDependency`, …) usable data-first, curried, or piped. `Package.decode(raw)`, `Package.toJsonString(options?)`, `Package.copyWith(patch)`.
- **`Package.resolve(pkg)`** — turns `catalog:`/`workspace:` specifiers into concrete ranges; requires `CatalogResolver | WorkspaceResolver` (contracts from `@effected/npm`) in `R` — real layers come from `@effected/workspaces`.
- **`PackageJsonFile`** — the one IO service: `read(path)` / `write(path, pkg, options?)` over core `FileSystem`/`Path`. Typed errors: `PackageJsonNotFoundError`, `PackageJsonParseError`, `PackageJsonReadError`, `PackageJsonWriteError`.
- **`PackageValidator`** — rule-based validation service; `PackageValidator.layer` (default rules) or `layerRules({ rules })`; raises `PackageValidationError`.
- **Leaf schemas** — `PackageName` (scoped/unscoped), `SpdxLicense`, `PackageManager` (parses `"pnpm@10.x+sha512.…"`), `Person` (parses `"Name <email> (url)"`), `Dependency`, re-exported `DependencySpecifier`.

## Usage

```ts
import { Package, PackageJsonFile } from "@effected/package-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
 const file = yield* PackageJsonFile;
 const pkg = yield* file.read("./package.json");
 yield* file.write("./package.json", Package.setVersion(pkg, pkg.version.bump.patch()));
});

Effect.runPromise(
 program.pipe(
  Effect.provide(PackageJsonFile.layer),
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
 ),
);
```

## Testing machinery

None exported. Compose `PackageJsonFile.layer` over an in-memory or test `FileSystem` layer for hermetic tests.

## Gotchas

- `PackageJsonFile.write` never resolves `catalog:`/`workspace:` specifiers — call `Package.resolve` first if the on-disk manifest needs concrete ranges.
- A missing file is typed `PackageJsonNotFoundError` (no TOCTOU `exists` pre-check), not a generic `PlatformError`.
- `publishConfig` is an open record (round-trips faithfully, but no typed `publishConfig.access` — read it off the raw record).
- `Schema.Class` instances are not `Pipeable` in v4; `Package` hand-rolls its own `pipe` overload.
