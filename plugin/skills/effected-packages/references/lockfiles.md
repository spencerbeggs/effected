# @effected/lockfiles

String-in, model-out parsing for all four package-manager lockfile formats (bun `bun.lock`, npm `package-lock.json`, pnpm `pnpm-lock.yaml`, yarn Berry `yarn.lock`) normalized into one `Lockfile` model of package *instances*, plus pure integrity checking against workspace manifests and a pure comparison of two lockfiles. Pure tier: no IO, no services, no `R` anywhere — every entrypoint takes a string or plain values.

**Input domain is narrower than "any lockfile of that manager"**: `Lockfile.parse` requires pnpm `lockfileVersion` **9+** and npm `lockfileVersion` **3+** — stated in lockfile-*format* terms, never manager-version terms, because a lockfile records no manager version and format 9 is not exclusive to pnpm 11. An older format fails typed rather than parsing into a wrong or partial model — and it fails as *too old* (`isUnsupportedLockfileVersion(cause)`), never as malformed, because the version gate runs ahead of the shape decode.

## Import

```ts
import { CatalogChange, ConfigDependencyLock, ImporterChange, Lockfile, LockfileDiff, LockfileFormat, LockfileIntegrity, PnpmEnvLockfile, isUnsupportedLockfileVersion } from "@effected/lockfiles";
```

Single entrypoint; no subpaths.

## Core API

- **`Lockfile.parse(content, { format })`** → `Effect<Lockfile, LockfileParseError | LockfileFramingError>` — one of three fallible boundaries (the others are `PnpmEnvLockfile.packageManager` and `.configDependencies`, below); `format` is `"bun" | "npm" | "pnpm" | "yarn"`. A pnpm/npm lockfile below the supported `lockfileVersion` fails `LockfileParseError` at `stage: "validation"` carrying an `UnsupportedLockfileVersion` cause (`{ format: "npm" | "pnpm", lockfileVersion, minimumSupported, message }`); narrow on it with `isUnsupportedLockfileVersion(error.cause)`, never on `message` prose. bun and yarn are ungated — neither records a comparable format-version line.
- **`PnpmEnvLockfile.packageManager(content)`** → `Effect<Option<PackageManagerLock>, LockfileParseError | LockfileFramingError>` — reads the pnpm env preamble (the FIRST document of the stream, the one `parse` skips) for the package manager the lockfile pins. `PackageManagerLock` carries `name` (always `"pnpm"`), the declared `specifier` verbatim, the resolved `version`, the SRI `integrity` of `pnpm@<version>`, and `nativeIntegrity` (SRI per native package keyed by bare name, e.g. `"@pnpm/exe.linux-x64"`; pnpm 12 records one per platform, pnpm 11 records none, so the record is empty). `Option.none()` means nothing is recorded (a single-document stream, or a preamble whose root importer declares no `pnpm`); a recorded version the preamble cannot back (no `packages` entry, no snapshot, missing or non-SRI integrity) fails `LockfileParseError` at `stage: "validation"`, never `none`; a stream of more than two documents fails `LockfileFramingError` (`reason: "unexpectedDocuments"`). Pure, like `parse`: text in, no IO.
- **`PnpmEnvLockfile.configDependencies(content)`** → `Effect<ReadonlyMap<string, ConfigDependencyLock>, LockfileParseError | LockfileFramingError>` — the same preamble's root-importer `configDependencies`, keyed by name. `ConfigDependencyLock` carries `name`, the recorded `specifier` (pnpm records the bare version even for a legacy inline `<version>+<integrity>` declaration), `version` and the SRI `integrity`. This is where a bare `configDependencies` entry keeps its integrity. Empty map when nothing is recorded; a recorded entry with no `packages` entry, no integrity, a non-SRI integrity or an empty version fails `LockfileParseError` at `stage: "validation"`. Same framing rule as `packageManager`.
- **`Lockfile`** (`Schema.Class`) — `format`, `lockfileVersion`, `packages: ResolvedPackage[]`, `workspaceDependencies`, `importers`, optional `extension` (`PnpmExtension | BunExtension`). Members: `withImporterNames(map)` (pure — rewrites pnpm importer-path-keyed names), `packagesNamed(name)`, `packageByInstanceId(instanceId)` → `Option<ResolvedPackage>`, `importer(path)` → `Option<LockfileImporter>`, `workspacePackages` getter.
- **`ResolvedPackage`** — a resolved package *instance*, not just a name@version: `instanceId` (the lockfile-native identity verbatim — pnpm's snapshot key, npm's full entry key, bun's `packages` key, yarn's locator; **opaque**, look it up with `Lockfile.packageByInstanceId`, never parse it), `name`, `version`, `isWorkspace`, `relativePath?`, `dependencies`/`peerDependencies`/`peerDependenciesMeta` (declared, default `{}`), `resolved` (outgoing edges: dependency/peer name → the `instanceId` it actually resolved to — every entry verified, never guessed), `unresolvedEdges` (dependency names the lockfile records an edge for but the model could not name, e.g. a `link:` target outside the workspace — distinct from a dependency the lockfile simply omits). `@effected/workspaces`' `PeerCheck` is built entirely on these fields.
- **`LockfileFormat`**, `filenameFor`, `fromFilename` — format ↔ filename mapping.
- **`LockfileIntegrity.compare(lockfile, manifests: ReadonlyArray<WorkspaceManifest>)`** → `LockfileIntegrity` — a **plain pure function** (no Effect, no error channel — a data type reporting facts, not something that fails): `valid` (`true` when fully consistent), `missingWorkspaces` (names in the manifests but absent from the lockfile), `extraWorkspaces` (names in the lockfile with no matching manifest), `unsatisfiedConstraints` (`{ workspace, dependency, constraint, resolved, depType }[]` — `depType` is one of the four dependency-field literals; a lockfile resolving the same package at several versions reports every candidate in `resolved`, and the constraint is satisfied when ANY of them matches). Unparseable ranges and `workspace:`/`link:`/`file:` specifiers are skipped by design (best-effort). Named `compare`, not `check` — every v4 `Schema.Class` already reserves `static check(...)` for schema checks.
- **`WorkspaceManifest`** — the minimal input shape `compare` checks a lockfile against: `name` plus the four optional dependency maps. Deliberately not a `@effected/package-json` type — this package takes manifests as plain values; `@effected/workspaces`' `WorkspacePackage.toWorkspaceManifest()` is the bridge from a real discovered package.
- **`LockfileDiff.compare(before, after)`** → `LockfileDiff` — what moved between two parsed lockfiles, what an update tool reports after an install. A **plain pure function** like `LockfileIntegrity.compare`: no Effect, no error channel. `hasChanges` is `false` exactly when both arrays are empty.
  - `catalogs: CatalogChange[]` — `catalog` (`"default"` for the default catalog in every format), `name`, `kind` (`"added" | "removed" | "changed"`), `specifier` and `version` as `{ before?, after? }`, and `consumers` (`{ importer, depType }[]`, the importers referencing the entry through `catalog:`, read from `before` for a removed entry).
  - `importers: ImporterChange[]` — identified by `importer`, `name` and `depType` together, with `kind`, `version`, and `specifier` sides that are classified specifiers, so `_tag` tells a `catalog:` reference apart.
  - A side that does not exist is absent, and so is a version that cannot be resolved. A record is `changed` when its specifier differs, or when its version resolves on both sides and differs; a version resolvable on one side only is not a change by itself.
  - Resolved versions are normalized across formats to what pnpm records, so one install reads alike in pnpm, bun and npm. An edge that lands on a workspace reads `link:<path>` relative to the importer, even when declared `file:`. A `file:` edge to a local directory or tarball that is not a workspace reads `file:<path>` relative to the workspace root, the same from every importer, so a version bump inside it is no change. A catalog entry that resolves to a workspace reads its own specifier as its version (`workspace:*`). Everything else reads the package entry's version.
  - npm writes a `file:` directory dependency exactly like a workspace link, so an npm link row is a workspace (`isWorkspace`, an importer) only when its target matches the root entry's `workspaces` globs, read as npm itself reads them (odd `!` negates, a later positive pattern cancels a negation it falls under, `*` skips dot directories, a `/**` negation ignores what lies beneath, a positive pattern ending in `/.` names the directory itself); any other link is a plain package. A `workspaces` field of more than 1000 patterns, more than 32 wildcard (non-plain-path) patterns, wildcard patterns whose brace expansion makes more than 256 alternatives in total (each counted exactly with `GlobPattern.alternativeCount`, so `{1..99}{a,b}` weighs 198, and a numeric range of 100 or more values weighs its value count, since matching it costs what its values would), a matched pattern (any negation, or a non-plain-path positive) longer than 256 characters, or a pattern glob will not compile, fails `Lockfile.parse` typed (`LockfileParseError`, `stage: "validation"`).
  - npm has no catalogs, and yarn records no importers, so two yarn lockfiles compare empty.
  - A catalog bump shows in `catalogs` and also in `importers` for each consumer whose resolved version moved; filter on `specifier.after?._tag !== "catalog"` to keep the two apart.

## Usage

```ts
import { Lockfile } from "@effected/lockfiles";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });
  return lockfile.workspacePackages.length;
});
```

Reading the actual report shape from `LockfileIntegrity.compare` — no `yield*`, it's a plain function:

```ts
import { LockfileIntegrity, WorkspaceManifest } from "@effected/lockfiles";

const manifests = [WorkspaceManifest.make({ name: "@app/core", dependencies: { effect: "^4.0.0" } })];
const report = LockfileIntegrity.compare(lockfile, manifests);

if (!report.valid) {
  for (const c of report.unsatisfiedConstraints) {
    console.warn(`${c.workspace}: ${c.dependency}@${c.constraint} (${c.depType}) not satisfied by resolved ${c.resolved}`);
  }
  console.warn("missing:", report.missingWorkspaces, "extra:", report.extraWorkspaces);
}
```

## Testing machinery

None exported — none needed; everything is pure.

## Gotchas

- pnpm lockfiles can be a two-document YAML stream — an env preamble, then the lockfile. pnpm 11 and 12 write the preamble when a workspace declares `configDependencies` or `devEngines.packageManager`. `parse` picks the LAST document and the `PnpmEnvLockfile` readers read the FIRST; a stream with no valid lockfile document fails `LockfileFramingError`, never an empty `Lockfile`.
- pnpm workspace packages are named by importer path with version `"0.0.0"` until you call `withImporterNames(map)` — you build the path→name map yourself (or let `@effected/workspaces` do the reading + naming).
- Integrity is `compare`, not `check` — `static check` is reserved by v4 `Schema.Class`.
- Yarn support is Berry only (classic v1 fails typed); yarn lockfiles always have `importers: []`.
- **Never write "requires pnpm 11+" or similar manager-version claims** — the gate is on `lockfileVersion`, and a lockfile does not record which manager version wrote it; format 9 is not exclusive to pnpm 11.
- A dependency name absent from BOTH `resolved`'s keys and `unresolvedEdges` is a genuine absence, not a gap — `unresolvedEdges` exists precisely so "nothing here" and "something here I couldn't name" stay distinguishable; don't conflate them when consuming `ResolvedPackage`.
