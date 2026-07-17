# @effected/package-json

## 0.3.0

### Breaking Changes

* ### Canonical key order re-baselined to `sort-package-json@4.0.0`

  `PackageFormatOptions`'s default sort (`sort: true`, the default) now places top-level keys in `sort-package-json@4.0.0`'s exact order rather than the kit's prior hand-maintained subset. This **changes the emitted bytes** of any `package.json` formatted with the default options — notably `packageManager` now sorts before `engines` / `devEngines`, and `sideEffects` moves after `publisher`, before `type`. `scripts`, `engines` and `bin` are now alphabetized alongside the dependency maps (previously only the dependency maps were sorted). An absent `scripts` key no longer materializes as `"scripts": {}` on encode — it's stripped like the dependency maps.

  Anything that diffs or snapshots formatted `package.json` output — CI checks, golden fixtures — will see a one-time reformat on upgrade. Pass `sort: false` to opt out and preserve prior key ordering.

  Because every `@effected/*` package is pre-`1.0.0` (majors are locked until Effect v4 GA), this ships as a `minor` rather than a `major` — treat it as breaking for compatibility planning regardless of the semver label.

### Features

* ### `PackageIndent` — tab and preserve-source indentation

  `PackageFormatOptions.indent` widens from `number` to `PackageIndent` (`number | "tab" | "preserve"`). `"tab"` indents with real tabs; `"preserve"` reuses the indentation detected from the original source text.

  ```ts
  import type { PackageFormatOptions } from "@effected/package-json";

  const options: PackageFormatOptions = { indent: "preserve" };
  ```

  ### `sourceText` option

  A new `sourceText` option backs `indent: "preserve"`: pass the original file text and its indentation (tabs vs. N spaces, detected from the first indented line) is reused; falls back to two spaces when absent. `PackageJsonFile.write` supplies the existing file's text automatically when `indent: "preserve"` is set without an explicit `sourceText` — reading the file being overwritten before it re-serializes. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.2.0

### Breaking Changes

* ### `Package.resolve` error channel widened

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

### Features

* ### Alias-form `workspace:` specifiers now resolve correctly

  `Package.resolve` now recognizes pnpm's alias form (`workspace:<name>@<range>`), resolving the **target** package's version rather than the dependency map key's, and projecting to the published `npm:<name>@<range>` alias — matching what pnpm actually publishes. Previously this form was not specially handled and could resolve to an incorrect specifier.

  ### Whitespace-only catalog names now select the default catalog

  A `catalog:` specifier whose name is only whitespace (e.g. `"catalog:  "`) now selects the default catalog, matching pnpm's own trimming behavior, instead of looking up a catalog literally named `"  "`.

### Bug Fixes

* The wire-codec encoder now lets typed fields win over a colliding key in `rest`, so a hand-built `Package` (or `.extend()`ed subclass) whose `rest` smuggles a known field name no longer shadows the typed member on the wire. [#83][#83]

### Dependencies

| Dependency    | Type       | Action  | From  | To    |
| ------------- | ---------- | ------- | ----- | ----- |
| @effected/npm | dependency | updated | 0.1.0 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#83]: https://github.com/spencerbeggs/effected/pull/83

## 0.1.0

### Features

* Initial release: package.json parsing, editing, validation and file IO as Effect schemas. `Package` is a `Schema.Class` over the manifest's known fields — `name` is a branded npm name, `version` is a real `SemVer` — with a `rest` catch-all that round-trips every unknown top-level key.

  ### The Package model

  Decode a manifest, edit it immutably, read the computed properties back. Mutation statics are dual, and serialization applies the canonical `sort-package-json` key order:

  ```ts
  import { Package } from "@effected/package-json";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const pkg = yield* Package.decode({ name: "@acme/widget", version: "1.0.0", private: true });
    const next = yield* Package.setVersion(pkg, "1.1.0");
    return [next.name, next.version.toString(), next.isScoped, next.isPrivate] as const;
  });

  console.log(Effect.runSync(program));
  // => ["@acme/widget", "1.1.0", true, true]
  ```

  ### File IO with typed failures

  `PackageJsonFile` is the only IO surface — one service, `read` and `write`, over core `FileSystem` / `Path`. `read` fails four distinct ways: `PackageJsonNotFoundError`, `PackageJsonReadError`, `PackageJsonParseError` and `PackageDecodeError`.

  ```ts
  import { PackageJsonFile } from "@effected/package-json";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const bumpMinor = Effect.gen(function* () {
    const files = yield* PackageJsonFile;
    const pkg = yield* files.read("./package.json");
    const next = pkg.copyWith({ version: pkg.version.bump.minor() });
    yield* files.write("./package.json", next);
  });

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  Effect.runPromise(bumpMinor.pipe(Effect.provide(PackageJsonFile.layer), Effect.provide(PlatformLive)));
  ```

  ### Validation and specifier resolution

  `PackageValidator` runs a replaceable rule set and aggregates every failure into one `PackageValidationError`. `Package.resolve` expands `catalog:` and `workspace:` specifiers through the `@effected/npm` resolver contracts as an explicit step `write` never performs for you. Leaf concepts (`PackageName`, `DependencySpecifier`, `Dependency`, `SpdxLicense`, `PackageManager`) are usable on their own. [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/npm    | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
