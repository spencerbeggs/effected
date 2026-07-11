# @effected/lockfiles

[![npm](https://img.shields.io/npm/v/@effected%2Flockfiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/lockfiles)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Pure lockfile parsing for [Effect](https://effect.website) v4: bun (`bun.lock`), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) normalized into one unified `Lockfile` schema model, plus pure integrity checking of that model against workspace manifests.

## Why @effected/lockfiles

Every package manager writes its lockfile in a different dialect — JSONC for bun, JSON for npm, YAML for pnpm and yarn — and each encodes packages, workspace edges and integrity data differently. `@effected/lockfiles` normalizes all four into one model so tooling asks one set of questions regardless of which package manager produced the file. Every entrypoint takes content as a string: the package performs no IO, and reading files, finding workspace roots and detecting package managers belong to its consumers. Malformed input always fails through the typed `LockfileParseError` channel (`stage: "syntax"` for text-level failures, `"validation"` for shape failures), never as a defect. Yarn support is Berry only: classic v1 `yarn.lock` content fails typed and is never mis-normalized.

## Install

```bash
npm install @effected/lockfiles @effected/jsonc @effected/semver @effected/yaml effect
```

```bash
pnpm add @effected/lockfiles @effected/jsonc @effected/semver @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect` v4, `@effected/jsonc`, `@effected/semver` and `@effected/yaml` are peer dependencies; the text-parsing engines arrive through those sibling packages, so this package adds no other runtime dependencies.

## Quick start

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

## Features

- `Lockfile.parse(content, { format })` — the package's only fallible boundary; fails with a typed `LockfileParseError` carrying the format and stage.
- `Lockfile#withImporterNames(names)` — the pure second stage for pnpm: rewrites importer-path names and both ends of each dependency edge once the consumer has read the manifests.
- `Lockfile#packagesNamed(name)` / `Lockfile#workspacePackages` — total lookups over the model.
- `LockfileFormat` — the format literal plus `filenameFor` / `fromFilename` for mapping between formats and lockfile filenames.
- `LockfileIntegrity.compare(lockfile, manifests)` — total, pure integrity checking with no error channel; the report carries `valid`, `missingWorkspaces`, `extraWorkspaces` and `unsatisfiedConstraints`.
- `WorkspaceManifest` — the manifest input shape for integrity checking: a package name plus four optional dependency records.
- `ResolvedPackage` — name, version, optional integrity hash, workspace flag and relative path, dependency map.
- `WorkspaceDependency` / `DependencyType` — a `from`/`to` edge between workspace packages with its dependency type and constraint.
- `PnpmExtension` / `BunExtension` — format-specific data such as pnpm catalogs and bun trusted dependencies, preserved on the model's optional `extension` field.

## License

[MIT](LICENSE)
