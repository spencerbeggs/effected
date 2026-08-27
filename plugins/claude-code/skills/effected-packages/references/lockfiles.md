# @effected/lockfiles

String-in, model-out parsing for all four package-manager lockfile formats (bun `bun.lock`, npm `package-lock.json`, pnpm `pnpm-lock.yaml`, yarn Berry `yarn.lock`) normalized into one `Lockfile` model of package *instances*, plus pure integrity checking against workspace manifests. Pure tier: no IO, no services, no `R` anywhere — every entrypoint takes a string or plain values.

**Input domain is narrower than "any lockfile of that manager"**: `Lockfile.parse` requires pnpm `lockfileVersion` **9+** and npm `lockfileVersion` **3+** — stated in lockfile-*format* terms, never manager-version terms, because a lockfile records no manager version and format 9 is not exclusive to pnpm 11. An older format fails typed rather than parsing into a wrong or partial model — and it fails as *too old* (`isUnsupportedLockfileVersion(cause)`), never as malformed, because the version gate runs ahead of the shape decode.

## Import

```ts
import { Lockfile, LockfileFormat, LockfileIntegrity, isUnsupportedLockfileVersion } from "@effected/lockfiles";
```

Single entrypoint; no subpaths.

## Core API

- **`Lockfile.parse(content, { format })`** → `Effect<Lockfile, LockfileParseError | LockfileFramingError>` — the only fallible boundary; `format` is `"bun" | "npm" | "pnpm" | "yarn"`. A pnpm/npm lockfile below the supported `lockfileVersion` fails `LockfileParseError` at `stage: "validation"` carrying an `UnsupportedLockfileVersion` cause (`{ format: "npm" | "pnpm", lockfileVersion, minimumSupported, message }`); narrow on it with `isUnsupportedLockfileVersion(error.cause)`, never on `message` prose. bun and yarn are ungated — neither records a comparable format-version line.
- **`Lockfile`** (`Schema.Class`) — `format`, `lockfileVersion`, `packages: ResolvedPackage[]`, `workspaceDependencies`, `importers`, optional `extension` (`PnpmExtension | BunExtension`). Members: `withImporterNames(map)` (pure — rewrites pnpm importer-path-keyed names), `packagesNamed(name)`, `packageByInstanceId(instanceId)` → `Option<ResolvedPackage>`, `importer(path)` → `Option<LockfileImporter>`, `workspacePackages` getter.
- **`ResolvedPackage`** — a resolved package *instance*, not just a name@version: `instanceId` (the lockfile-native identity verbatim — pnpm's snapshot key, npm's full entry key, bun's `packages` key, yarn's locator; **opaque**, look it up with `Lockfile.packageByInstanceId`, never parse it), `name`, `version`, `isWorkspace`, `relativePath?`, `dependencies`/`peerDependencies`/`peerDependenciesMeta` (declared, default `{}`), `resolved` (outgoing edges: dependency/peer name → the `instanceId` it actually resolved to — every entry verified, never guessed), `unresolvedEdges` (dependency names the lockfile records an edge for but the model could not name, e.g. a `link:` target outside the workspace — distinct from a dependency the lockfile simply omits). `@effected/workspaces`' `PeerCheck` is built entirely on these fields.
- **`LockfileFormat`**, `filenameFor`, `fromFilename` — format ↔ filename mapping.
- **`LockfileIntegrity.compare(lockfile, manifests: ReadonlyArray<WorkspaceManifest>)`** → `LockfileIntegrity` — a **plain pure function** (no Effect, no error channel — a data type reporting facts, not something that fails): `valid` (`true` when fully consistent), `missingWorkspaces` (names in the manifests but absent from the lockfile), `extraWorkspaces` (names in the lockfile with no matching manifest), `unsatisfiedConstraints` (`{ workspace, dependency, constraint, resolved, depType }[]` — `depType` is one of the four dependency-field literals; a lockfile resolving the same package at several versions reports every candidate in `resolved`, and the constraint is satisfied when ANY of them matches). Unparseable ranges and `workspace:`/`link:`/`file:` specifiers are skipped by design (best-effort, matching the v3 implementation). Named `compare`, not `check` — every v4 `Schema.Class` already reserves `static check(...)` for schema checks.
- **`WorkspaceManifest`** — the minimal input shape `compare` checks a lockfile against: `name` plus the four optional dependency maps. Deliberately not a `@effected/package-json` type — this package takes manifests as plain values; `@effected/workspaces`' `WorkspacePackage.toWorkspaceManifest()` is the bridge from a real discovered package.

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

- pnpm lockfiles can be a two-document YAML stream (a `configDependencies` preamble, then the lockfile) — `parse` picks the LAST document; a stream with no valid lockfile document fails `LockfileFramingError`, never an empty `Lockfile`.
- pnpm workspace packages are named by importer path with version `"0.0.0"` until you call `withImporterNames(map)` — you build the path→name map yourself (or let `@effected/workspaces` do the reading + naming).
- Integrity is `compare`, not `check` — `static check` is reserved by v4 `Schema.Class`.
- Yarn support is Berry only (classic v1 fails typed); yarn lockfiles always have `importers: []`.
- **Never write "requires pnpm 11+" or similar manager-version claims** — the gate is on `lockfileVersion`, and a lockfile does not record which manager version wrote it; format 9 is not exclusive to pnpm 11.
- A dependency name absent from BOTH `resolved`'s keys and `unresolvedEdges` is a genuine absence, not a gap — `unresolvedEdges` exists precisely so "nothing here" and "something here I couldn't name" stay distinguishable; don't conflate them when consuming `ResolvedPackage`.
