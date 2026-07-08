---
"@effected/package-json": minor
---

## Features

Initial release of `@effected/package-json` — package.json parsing, editing, validation and file IO as Effect `Schema` classes. `Package` is the schema: typed known fields plus a `rest` catch-all for round-trip fidelity, semantic field decoding (`version` → `SemVer`, `license` → SPDX, `packageManager`, `author`/`contributors` → `Person`), computed getters, dual-signature immutable mutation statics, and a `.extend()` story for custom fields. The only IO surface, `PackageJsonFile`, reads and writes over core `FileSystem`/`Path` — no `@effect/platform` peer required:

```ts
import { Package } from "@effected/package-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const pkg = yield* Package.decode({ name: "my-pkg", version: "1.0.0" });
	const next = yield* Package.setVersion(pkg, "1.1.0");
	console.log(next.toJsonString());
});
```

### Package (the core model)

* Computed getters — `isPrivate`, `isScoped`, `isESM`, `hasDependency(name)`, `getDependencies()`/`getDevDependencies()`/`getPeerDependencies()`/`getOptionalDependencies()` returning `HashMap<string, Dependency>`.
* Dual-signature mutation statics (data-first, curried and pipeable call styles all work) — `setVersion`, `setName`, `setLicense` (effectful, typed failures) plus sync `addDependency`/`removeDependency` and their `Dev`/`Peer`/`Optional` counterparts, and `setScript`/`removeScript`.
* `copyWith(patch)` — a patch type derived from every modeled field, so it never silently omits one.
* `Package.resolve` — resolves `catalog:`/`workspace:` specifiers across all four dependency maps using `CatalogResolver`/`WorkspaceResolver` from `@effected/npm`. Explicit and separate from `write` — writing a file never mutates its contents.
* `toJsonString(options?)` — pure serialization with canonical key order, dependency sorting and empty-map stripping, each toggleable via `PackageFormatOptions`.
* `Package.schema` and `Package.wireFor(Subclass)` — the wire transform partitions raw keys against a class's fields, so `.extend()`ed subclasses automatically pull their new fields out of `rest` into typed members.

### Dependency and DependencySpecifier

* One `Dependency` class with a `kind: "prod" | "dev" | "peer" | "optional"` field, replacing four copy-pasted classes; its protocol getters (`isLocal`, `isGit`, `isRange`, `isTag`, `isCatalog`, `isWorkspace`, `isUnresolved`, ...) delegate to `DependencySpecifier`.
* `DependencySpecifier` — a single classification taxonomy. `protocolOf(s)` classifies any specifier into `range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`, alongside matching `isRange`/`isTag`/`isGit`/`isUrl`/`isLocal`/`isLink`/`isPortal`/`isCatalog`/`isWorkspace` predicates and a typed `decode` helper.
* `isUnresolvedDependency` — a type guard narrowing to a `Dependency` whose specifier is an unresolved `catalog:`/`workspace:` protocol.

### PackageName, License, PackageManager, Person, DevEngines

* `PackageName` (`ScopedPackageName` | `UnscopedPackageName`) — npm name validation with `isValid`, `scope`, `unscoped`, `isScoped` statics.
* `SpdxLicense` — validates real SPDX expressions plus the `UNLICENSED` and `SEE LICENSE IN <file>` npm special cases.
* `PackageManager` — parses `"pnpm@10.33.0+sha512.abc"` into `name`/`version`/`integrity: Option<string>`, with a `FromString` string codec.
* `Person` — parses the `"Name <email> (url)"` shorthand into structured fields and back, wired into `Package.author`/`Package.contributors`.
* `DevEngine` / `DevEnginesSchema` — models the `devEngines` field's `packageManager`/`runtime`/`os`/`cpu`/`libc` constraint slots.

### PackageValidator

`Context.Service` running rule-based validation, aggregating every failure into one `PackageValidationError` instead of failing fast:

* `PackageValidator.layer` — the default rules (`has-license`, `has-description`, `has-repository`, `not-private`).
* `PackageValidator.layerRules({ rules })` — a parameterized layer factory for a custom rule set; ships `noUnresolvedDepsRule` and `noLocalDepsRule` as ready-made extras.

### PackageJsonFile (the only IO)

`Context.Service` reading and writing package.json over core `FileSystem`/`Path` — consumers provide a platform implementation (e.g. `@effect/platform-node`'s `NodeFileSystem`/`NodePath`) at the edge.

* `read(path)` — fails with `PackageJsonReadError`, `PackageJsonNotFoundError` (its own tag for `catchTag` routing), `PackageJsonParseError`, or `PackageDecodeError`.
* `write(path, pkg, options?)` — fails with `PackageJsonWriteError`, narrowed to the filesystem-write failure only; resolution is never fused into `write`.

### Typed Errors

Ten `Schema.TaggedErrorClass` errors cover every failure mode — `PackageDecodeError`, `InvalidPackageNameError`, `InvalidSpdxLicenseError`, `InvalidDependencySpecifierError`, `PackageValidationError`, `DependencyResolutionError` (from `@effected/npm`), and the four `PackageJsonFile` read/write errors — each carrying structured payload fields (`input`, `cause: Schema.Defect`, aggregated `failures`, ...) rather than opaque messages.
