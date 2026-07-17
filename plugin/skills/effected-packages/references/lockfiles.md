# @effected/lockfiles

String-in, model-out parsing for all four package-manager lockfile formats (bun `bun.lock`, npm `package-lock.json` v2/v3, pnpm `pnpm-lock.yaml`, yarn Berry `yarn.lock`) normalized into one `Lockfile` model, plus pure integrity checking against workspace manifests. Pure tier: no IO, no services, no `R` anywhere — every entrypoint takes a string or plain values.

## Import

```ts
import { Lockfile, LockfileFormat, LockfileIntegrity } from "@effected/lockfiles";
```

Single entrypoint; no subpaths.

## Core API

- **`Lockfile.parse(content, { format })`** → `Effect<Lockfile, LockfileParseError | LockfileFramingError>` — the only fallible boundary; `format` is `"bun" | "npm" | "pnpm" | "yarn"`.
- **`Lockfile`** (`Schema.Class`) — `format`, `lockfileVersion`, `packages: ResolvedPackage[]`, `workspaceDependencies`, `importers`, optional `extension` (`PnpmExtension | BunExtension`). Members: `withImporterNames(map)` (pure — rewrites pnpm importer-path-keyed names), `packagesNamed(name)`, `importer(path)` → `Option<LockfileImporter>`, `workspacePackages` getter.
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
