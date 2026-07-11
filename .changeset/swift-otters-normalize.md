---
"@effected/lockfiles": minor
---

## Features

Initial release of `@effected/lockfiles` — pure lockfile parsing for [Effect](https://effect.website) v4: bun (`bun.lock` JSONC), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) normalized into one unified `Lockfile` schema model, plus pure integrity checking of that model against workspace manifests. Every entrypoint takes content as a string — the package performs no IO, and reading files, finding workspace roots and detecting package managers stay with its consumers:

```ts
import { Lockfile, LockfileIntegrity, WorkspaceManifest } from "@effected/lockfiles";
import { Effect } from "effect";

declare const content: string; // lockfile text, read by the caller

const program = Effect.gen(function* () {
  // The only fallible boundary: malformed input fails with a typed
  // LockfileParseError ({ format, stage: "syntax" | "validation", cause }).
  const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });

  // pnpm workspace packages come back keyed by importer path; rewrite them
  // once you have read the manifests (a pure, total second stage).
  const named = lockfile.withImporterNames(
    new Map([["packages/core", "@acme/core"]]),
  );

  // Total lookups over the model.
  const versions = named.packagesNamed("typescript").map((p) => p.version);
  const workspaces = named.workspacePackages;

  // Pure integrity checking — no Effect, no error channel, no IO.
  const report = LockfileIntegrity.compare(named, [
    WorkspaceManifest.make({ name: "@acme/core", dependencies: { lodash: "^4.17.0" } }),
  ]);

  return { versions, workspaces: workspaces.length, valid: report.valid };
});
```

### One model, one typed error

`Lockfile.parse(content, { format })` is the package's only fallible boundary, regardless of which of the four formats is being read. Every failure is a single typed `LockfileParseError` carrying the `format` and a `stage` of `"syntax"` (text-level failures) or `"validation"` (shape failures) — never an unhandled defect, even on hostile input.

### pnpm importer resolution and integrity checking

* `lockfile.withImporterNames(map)` — the pure, total second stage for pnpm: pnpm lockfiles name workspace packages by importer *path*; this rewrites those names and both ends of every dependency edge once the caller has read the manifests.
* `lockfile.packagesNamed(name)` / `lockfile.workspacePackages` — total lookups over the model, including multi-version results for hoisted packages.
* `LockfileIntegrity.compare(lockfile, manifests)` — total, pure integrity checking with no error channel. The report carries `valid`, `missingWorkspaces`, `extraWorkspaces` and `unsatisfiedConstraints` against a list of `WorkspaceManifest` values (a package name plus four optional dependency records).

### Format mapping and extension data

* `LockfileFormat` — the format literal plus `filenameFor` / `fromFilename` for mapping between formats and lockfile filenames in either direction.
* `PnpmExtension` / `BunExtension` — format-specific data (pnpm catalogs, via the exported `PnpmCatalogs` type, and bun trusted dependencies) preserved on the model's optional `extension` field.
* `ResolvedPackage` — name, version, optional integrity hash, workspace flag and relative path, dependency map.
* `WorkspaceDependency` / `DependencyType` — a `from`/`to` edge between workspace packages with its dependency type and constraint.

### Hardened against hostile input

Yarn support is Berry only — classic v1 `yarn.lock` content fails typed at validation rather than being silently mis-normalized. Key-bearing intermediates are built with `Map`/`Set` and `Object.fromEntries`, so a `__proto__` key in lockfile content neither pollutes nor silently drops. Malformed rows are skipped rather than thrown on, and nesting bombs surface the delegated `@effected/jsonc` and `@effected/yaml` engines' own typed failures.

Peers: `effect` plus `@effected/jsonc`, `@effected/semver` and `@effected/yaml` (`workspace:*`); no other runtime dependencies.
