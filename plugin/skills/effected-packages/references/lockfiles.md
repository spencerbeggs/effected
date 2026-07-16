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
- **`LockfileIntegrity.compare(lockfile, manifests)`** — a **plain pure function** (no Effect) reporting satisfied/missing/extra/unsatisfied constraints; unparseable ranges and `workspace:`/`link:`/`file:` specifiers are skipped by design.

## Usage

```ts
import { Lockfile } from "@effected/lockfiles";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });
 return lockfile.workspacePackages.length;
});
```

```ts
import { LockfileIntegrity } from "@effected/lockfiles";
const report = LockfileIntegrity.compare(lockfile, manifests); // pure, no yield*
```

## Testing machinery

None exported — none needed; everything is pure.

## Gotchas

- pnpm lockfiles can be a two-document YAML stream (a `configDependencies` preamble, then the lockfile) — `parse` picks the LAST document; a stream with no valid lockfile document fails `LockfileFramingError`, never an empty `Lockfile`.
- pnpm workspace packages are named by importer path with version `"0.0.0"` until you call `withImporterNames(map)` — you build the path→name map yourself (or let `@effected/workspaces` do the reading + naming).
- Integrity is `compare`, not `check` — `static check` is reserved by v4 `Schema.Class`.
- Yarn support is Berry only (classic v1 fails typed); yarn lockfiles always have `importers: []`.
